/**
 * Tests Cancel → Free (compte isolé Stripe test).
 * Usage: npx tsx --tsconfig tsconfig.json scripts/test-cancel-to-free.ts
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

import { loadEnvFiles } from "./lib/load-env-files";

loadEnvFiles(process.cwd(), { override: true });
loadEnvFiles(process.cwd(), {
  override: true,
  files: [".env.cloud-beta.local", ".env.local", ".env.stripe-prices.local"],
});

import { getStripePriceIdForPlan } from "../src/config/billing";
import { getStripe, isStripeConfigured } from "../src/lib/stripe";
import {
  hasPaidAccess,
  resolveAccessBadge,
  resolveEffectivePlan,
} from "../src/services/billing/access";
import { applyStripeSubscription } from "../src/services/billing/apply-subscription";
import {
  cancelPremiumSubscription,
  resumePremiumSubscription,
} from "../src/services/billing/cancel";
import { getOrCreateStripeCustomer } from "../src/services/billing/customers";
import { hasEntitlement } from "../src/services/billing/entitlements";
import { getUserSubscription } from "../src/services/billing/store";
import { syncUserSubscriptionFromStripe } from "../src/services/billing/sync";

const VALID_PM = "pm_card_visa";

type Row = { scenario: string; verdict: "OK" | "KO" | "NON TESTÉ"; proof: string };
const rows: Row[] = [];

function log(row: Row) {
  rows.push(row);
  console.log(`[${row.verdict}] ${row.scenario}\n  → ${row.proof}\n`);
}

async function createIsolatedUser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  assert.ok(url && service);
  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `cancel-test+${Date.now()}@docmind.test`;
  const created = await admin.auth.admin.createUser({
    email,
    password: `Cx!${Date.now()}`,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error("createUser");
  }
  const userId = created.data.user.id;
  return {
    userId,
    email,
    cleanup: async () => {
      const sub = await getUserSubscription(userId).catch(() => null);
      const stripe = getStripe();
      if (sub?.stripeSubscriptionId) {
        await stripe.subscriptions
          .cancel(sub.stripeSubscriptionId)
          .catch(() => undefined);
      }
      if (sub?.stripeCustomerId) {
        await stripe.customers.del(sub.stripeCustomerId).catch(() => undefined);
      }
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    },
  };
}

async function seedPro(userId: string, email: string) {
  const stripe = getStripe();
  const priceId = getStripePriceIdForPlan("pro");
  assert.ok(priceId);
  const customerId = await getOrCreateStripeCustomer({ userId, email });
  const pm = await stripe.paymentMethods.attach(VALID_PM, { customer: customerId });
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: pm.id },
  });
  const sub = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    default_payment_method: pm.id,
    metadata: { docmind_user_id: userId, docmind_plan: "pro", plan: "pro" },
    expand: ["items.data.price"],
  });
  await applyStripeSubscription(userId, sub, {
    id: `seed_${sub.id}`,
    type: "customer.subscription.created",
    created: Math.floor(Date.now() / 1000),
  });
  return sub.id;
}

async function invoiceCountSince(
  customerId: string,
  sinceSec: number,
): Promise<number> {
  const stripe = getStripe();
  const list = await stripe.invoices.list({ customer: customerId, limit: 20 });
  return list.data.filter((inv) => (inv.created ?? 0) >= sinceSec).length;
}

async function testCancelAtPeriodEndKeepsAccess() {
  const { userId, email, cleanup } = await createIsolatedUser();
  try {
    await seedPro(userId, email);
    const before = await getUserSubscription(userId);
    const since = Math.floor(Date.now() / 1000);

    await cancelPremiumSubscription({ userId, immediately: false });
    await syncUserSubscriptionFromStripe(userId);
    const local = await getUserSubscription(userId);
    const stripe = getStripe();
    const stripeSub = await stripe.subscriptions.retrieve(
      before.stripeSubscriptionId!,
    );

    const effective = resolveEffectivePlan(local.plan, local.status, {
      currentPeriodEnd: local.currentPeriodEnd,
    });
    const letter = await hasEntitlement(userId, "letter_agent");
    const badge = resolveAccessBadge(local).id;
    const newInvoices = await invoiceCountSince(
      before.stripeCustomerId!,
      since,
    );

    const ok =
      stripeSub.cancel_at_period_end === true &&
      stripeSub.status === "active" &&
      local.plan === "pro" &&
      local.cancelAtPeriodEnd === true &&
      effective === "pro" &&
      letter === true &&
      badge === "canceling" &&
      newInvoices === 0;

    log({
      scenario: "Annulation fin de période — accès payant conservé",
      verdict: ok ? "OK" : "KO",
      proof: `stripe active+cancel_at_period_end, local=${local.plan}, effective=${effective}, letter=${letter}, badge=${badge}, newInvoices=${newInvoices}`,
    });

    await resumePremiumSubscription(userId);
  } finally {
    await cleanup();
  }
}

async function testImmediateCancelToFree() {
  const { userId, email, cleanup } = await createIsolatedUser();
  try {
    await seedPro(userId, email);
    const before = await getUserSubscription(userId);
    const since = Math.floor(Date.now() / 1000);

    await cancelPremiumSubscription({ userId, immediately: true });
    await syncUserSubscriptionFromStripe(userId);
    const local = await getUserSubscription(userId);
    const stripe = getStripe();
    const stripeSub = await stripe.subscriptions.retrieve(
      before.stripeSubscriptionId!,
    );

    const effective = resolveEffectivePlan(local.plan, local.status, {
      currentPeriodEnd: local.currentPeriodEnd,
    });
    const letter = await hasEntitlement(userId, "letter_agent");
    const paid = hasPaidAccess(local.plan, local.status, {
      currentPeriodEnd: local.currentPeriodEnd,
    });
    const newInvoices = await invoiceCountSince(
      before.stripeCustomerId!,
      since,
    );

    const ok =
      stripeSub.status === "canceled" &&
      local.plan === "free" &&
      effective === "free" &&
      letter === false &&
      paid === false &&
      newInvoices === 0;

    log({
      scenario: "Annulation immédiate → Free + entitlements révoqués",
      verdict: ok ? "OK" : "KO",
      proof: `stripe=${stripeSub.status}, local=${local.plan}/${local.status}, effective=${effective}, letter=${letter}, newInvoices=${newInvoices}`,
    });
  } finally {
    await cleanup();
  }
}

async function testAfterPeriodEndWebhookToFree() {
  const { userId, email, cleanup } = await createIsolatedUser();
  try {
    const subId = await seedPro(userId, email);
    const stripe = getStripe();
    const full = await stripe.subscriptions.retrieve(subId, {
      expand: ["items.data.price"],
    });

    const canceled = {
      ...full,
      status: "canceled",
      cancel_at_period_end: false,
      canceled_at: Math.floor(Date.now() / 1000),
    } as typeof full;

    await applyStripeSubscription(userId, canceled, {
      id: `evt_period_end_${Date.now()}`,
      type: "customer.subscription.deleted",
      created: Math.floor(Date.now() / 1000),
    });

    const local = await getUserSubscription(userId);
    const effective = resolveEffectivePlan(local.plan, local.status, {
      currentPeriodEnd: local.currentPeriodEnd,
    });
    const letter = await hasEntitlement(userId, "letter_agent");

    const ok =
      local.plan === "free" &&
      local.status === "canceled" &&
      effective === "free" &&
      letter === false;

    log({
      scenario: "Fin de période (webhook deleted) → Free",
      verdict: ok ? "OK" : "KO",
      proof: `local=${local.plan}/${local.status}, effective=${effective}, letter=${letter}`,
    });
  } finally {
    await cleanup();
  }
}

async function testEffectivePlanAfterPeriodExpired() {
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const effective = resolveEffectivePlan("premium", "active", {
    currentPeriodEnd: past,
  });
  const ok = effective === "free";
  log({
    scenario: "Période expirée (logique access) → plan effectif free",
    verdict: ok ? "OK" : "KO",
    proof: `resolveEffectivePlan(premium, active, past)=${effective}`,
  });
}

async function testUiBillingFields() {
  const sub = {
    plan: "pro" as const,
    status: "active" as const,
    cancelAtPeriodEnd: true,
    currentPeriodEnd: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    canceledAt: new Date().toISOString(),
    stripeSubscriptionId: "sub_x",
  };
  const badge = resolveAccessBadge(sub);
  const ok =
    badge.id === "canceling" &&
    badge.label === "Expire bientôt" &&
    badge.description.includes("jusqu");
  log({
    scenario: "UI /facturation — badge annulation programmée",
    verdict: ok ? "OK" : "KO",
    proof: `${badge.id} / "${badge.label}"`,
  });
}

async function main() {
  assert.ok(isStripeConfigured());
  assert.ok(
    (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_"),
    "Stripe test requis",
  );

  await testEffectivePlanAfterPeriodExpired();
  await testUiBillingFields();
  await testCancelAtPeriodEndKeepsAccess();
  await testImmediateCancelToFree();
  await testAfterPeriodEndWebhookToFree();

  console.log("=== RÉSUMÉ ===");
  for (const r of rows) {
    console.log(`${r.verdict.padEnd(10)} | ${r.scenario}`);
  }
  process.exit(rows.some((r) => r.verdict === "KO") ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
