/**
 * Vérifie abonnement Premium + test annulation → webhook → Free.
 * Usage: npx tsx scripts/test-user-billing-lifecycle.ts yoyo270706@gmail.com
 */
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

import { loadEnvFiles } from "./lib/load-env-files";

loadEnvFiles(process.cwd(), { override: true });

import { getPlanQuotas } from "../src/config/quotas";
import { hasPremiumAccess } from "../src/services/billing/access";
import {
  applyStripeSubscription,
  planFromSubscription,
} from "../src/services/billing/apply-subscription";
import { getUserEntitlements } from "../src/services/billing/entitlements";
import { getUserSubscription } from "../src/services/billing/store";
import { syncUserSubscriptionFromStripe } from "../src/services/billing/sync";
import {
  handleStripeWebhookEvent,
  processStripeWebhookEvent,
} from "../src/services/billing/webhook";
import { getStripe, isStripeConfigured } from "../src/lib/stripe";

const email = (process.argv[2] || "yoyo270706@gmail.com").trim().toLowerCase();
const skipCancelTest = process.argv.includes("--skip-cancel");

async function findSupabaseUserId(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !service) return null;
  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const hit = data.users.find(
      (u) => u.email?.trim().toLowerCase() === email,
    );
    if (hit?.id) return hit.id;
    if (data.users.length < 200) break;
    page += 1;
  }
  return null;
}

async function findStripeCustomer(): Promise<Stripe.Customer | null> {
  const stripe = getStripe();
  const list = await stripe.customers.list({ email, limit: 10 });
  return list.data[0] ?? null;
}

async function activeSubscription(
  customerId: string,
): Promise<Stripe.Subscription | null> {
  const stripe = getStripe();
  const list = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 20,
    expand: ["data.items.data.price"],
  });
  const active = list.data.find((s) =>
    ["active", "trialing", "past_due"].includes(s.status),
  );
  return active ?? list.data[0] ?? null;
}

function subEvent(
  sub: Stripe.Subscription,
  type: Stripe.Event.Type,
  id: string,
): Stripe.Event {
  return {
    id,
    object: "event",
    api_version: "2026-06-24.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    data: { object: sub },
  } as Stripe.Event;
}

async function assertPremium(userId: string, label: string) {
  const sub = await getUserSubscription(userId);
  const premium = hasPremiumAccess(sub.plan, sub.status);
  const limits = getPlanQuotas(sub.plan);
  const ents = await getUserEntitlements(userId);
  console.log(`\n[${label}]`, {
    plan: sub.plan,
    status: sub.status,
    premium,
    analyzeLimit: limits.analyze,
    letterAgent: ents.includes("letter_agent"),
    stripeSubscriptionId: sub.stripeSubscriptionId,
    periodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  });
  assert.equal(sub.plan, "premium", `${label}: plan attendu premium`);
  assert.equal(premium, true, `${label}: accès premium attendu`);
  assert.equal(limits.analyze, 200, `${label}: quota analyze=200`);
  return sub;
}

async function assertFree(userId: string, label: string) {
  const sub = await getUserSubscription(userId);
  const premium = hasPremiumAccess(sub.plan, sub.status);
  const limits = getPlanQuotas(sub.plan);
  const ents = await getUserEntitlements(userId);
  console.log(`\n[${label}]`, {
    plan: sub.plan,
    status: sub.status,
    premium,
    analyzeLimit: limits.analyze,
    letterAgent: ents.includes("letter_agent"),
    stripeSubscriptionId: sub.stripeSubscriptionId,
  });
  assert.equal(sub.plan, "free", `${label}: plan attendu free`);
  assert.equal(premium, false, `${label}: premium=false`);
  assert.equal(limits.analyze, 20, `${label}: quota analyze=20`);
  assert.equal(ents.includes("letter_agent"), false, `${label}: pas letter_agent`);
}

async function main() {
  if (!isStripeConfigured()) {
    console.error("STRIPE_SECRET_KEY manquant");
    process.exit(1);
  }

  console.log("Email:", email);
  console.log("STRIPE_PRICE_PREMIUM:", process.env.STRIPE_PRICE_PREMIUM ?? "(unset)");
  console.log("DOCMIND_STORAGE:", process.env.DOCMIND_STORAGE ?? "(auto)");

  const userId = await findSupabaseUserId();
  if (!userId) {
    console.error("Utilisateur Supabase introuvable pour", email);
    process.exit(1);
  }
  console.log("userId:", userId);

  const customer = await findStripeCustomer();
  if (!customer) {
    console.error("Customer Stripe introuvable pour", email);
    process.exit(1);
  }
  console.log("stripeCustomerId:", customer.id);

  const stripeSub = await activeSubscription(customer.id);
  if (!stripeSub) {
    console.error("Aucun abonnement Stripe pour ce customer");
    process.exit(1);
  }

  const stripe = getStripe();
  const fullSub = await stripe.subscriptions.retrieve(stripeSub.id, {
    expand: ["items.data.price"],
  });

  const mappedPlan = planFromSubscription(fullSub);
  const periodEnd = fullSub.items?.data?.[0]?.current_period_end;
  console.log("\nSTRIPE subscription:", {
    id: fullSub.id,
    status: fullSub.status,
    mappedPlan,
    priceId: fullSub.items?.data?.[0]?.price?.id ?? null,
    currentPeriodEnd: periodEnd
      ? new Date(periodEnd * 1000).toISOString()
      : null,
    cancelAtPeriodEnd: fullSub.cancel_at_period_end,
    metadata: fullSub.metadata,
  });

  if (mappedPlan !== "premium") {
    console.warn(
      "\nWARN: Stripe actif mais price ≠ STRIPE_PRICE_PREMIUM → plan local sera free.",
    );
    console.warn(
      "→ Alignez le checkout sur STRIPE_PRICE_PREMIUM ou mettez à jour STRIPE_PRICE_PREMIUM.",
    );
  }

  // Sync depuis Stripe
  await syncUserSubscriptionFromStripe(userId);
  if (mappedPlan === "premium") {
    await assertPremium(userId, "Après sync Stripe");
  } else {
    const local = await getUserSubscription(userId);
    console.log("\n[Après sync Stripe] plan local:", local.plan, "(price mismatch)");
  }

  if (skipCancelTest) {
    console.log("\n--skip-cancel : test annulation ignoré");
    return;
  }

  // --- Test webhook annulation immédiate → Free ---
  const canceledSub = {
    ...fullSub,
    status: "canceled",
    cancel_at_period_end: false,
    canceled_at: Math.floor(Date.now() / 1000),
  } as unknown as Stripe.Subscription;

  const deletedEvent = subEvent(
    canceledSub,
    "customer.subscription.deleted",
    `evt_test_cancel_${Date.now()}`,
  );

  const claimStore = new Set<string>();
  const webhookResult = await processStripeWebhookEvent(deletedEvent, {
    isClaimed: async (id) => claimStore.has(id),
    claim: async (id) => {
      claimStore.add(id);
      return true;
    },
    dispatch: async (event) => {
      const sub = event.data.object as Stripe.Subscription;
      const uid =
        sub.metadata?.docmind_user_id?.trim() ||
        userId;
      await applyStripeSubscription(uid, sub, {
        id: event.id,
        type: event.type,
        created: event.created,
      });
      return { handled: true };
    },
  });

  assert.equal(webhookResult.handled, true, "webhook deleted handled");
  await assertFree(userId, "Après webhook subscription.deleted");

  // --- Test idempotence duplicate deleted ---
  const dup = await processStripeWebhookEvent(deletedEvent, {
    isClaimed: async (id) => claimStore.has(id),
    claim: async (id) => {
      claimStore.add(id);
      return true;
    },
    dispatch: async () => {
      throw new Error("dispatch ne doit pas être rappelé");
    },
  });
  assert.equal(dup.handled, true, "duplicate event idempotent");

  // --- Restaurer Premium si Stripe encore actif (ne pas laisser le test casser le compte) ---
  if (fullSub.status !== "canceled") {
    console.log("\nRestauration état Premium depuis Stripe réel…");
    const restoreEvent = subEvent(
      fullSub,
      "customer.subscription.updated",
      `evt_test_restore_${Date.now()}`,
    );
    await handleStripeWebhookEvent(restoreEvent);
    if (mappedPlan === "premium") {
      await assertPremium(userId, "Après restauration");
    }
  }

  console.log("\nOK test-user-billing-lifecycle");
}

main().catch((err) => {
  console.error("\nFAIL:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
