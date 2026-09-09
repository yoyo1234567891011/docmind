/**
 * Test carte refusée — abonnement inchangé si paiement échoue.
 * Usage: npx tsx --tsconfig tsconfig.json scripts/test-declined-card-billing.ts
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

import { loadEnvFiles } from "./lib/load-env-files";

loadEnvFiles(process.cwd(), { override: true });
loadEnvFiles(process.cwd(), {
  override: true,
  files: [".env.cloud-beta.local", ".env.local", ".env.stripe-prices.local"],
});

import { getStripePriceIdForPlan, planIdFromStripePriceId } from "../src/config/billing";
import { AppError } from "../src/lib/errors";
import { getStripe, isStripeConfigured } from "../src/lib/stripe";
import { applyStripeSubscription } from "../src/services/billing/apply-subscription";
import { changeSubscriptionPlan } from "../src/services/billing/change-plan";
import { createPlanCheckoutSession } from "../src/services/billing/checkout";
import { getOrCreateStripeCustomer } from "../src/services/billing/customers";
import { getUserSubscription } from "../src/services/billing/store";
import { syncUserSubscriptionFromStripe } from "../src/services/billing/sync";
import type { PaidBillingPlanId } from "../src/types/billing";

const VALID_PM = "pm_card_visa";

async function removeCustomerPaymentMethods(customerId: string): Promise<void> {
  const stripe = getStripe();
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: "" },
  });
  const pms = await stripe.paymentMethods.list({
    customer: customerId,
    type: "card",
  });
  for (const pm of pms.data) {
    await stripe.paymentMethods.detach(pm.id);
  }
}

type Row = { scenario: string; verdict: "OK" | "KO" | "NON TESTÉ"; proof: string };
const rows: Row[] = [];

function log(row: Row) {
  rows.push(row);
  console.log(`[${row.verdict}] ${row.scenario}\n  → ${row.proof}\n`);
}

async function createIsolatedUser(): Promise<{
  userId: string;
  email: string;
  cleanup: () => Promise<void>;
}> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  assert.ok(url && service, "Supabase admin requis");

  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `declined-card+${Date.now()}@docmind.test`;
  const password = `Dc!${Date.now()}`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error("createUser failed");
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

async function seedPaidSubscription(
  userId: string,
  email: string,
  plan: PaidBillingPlanId,
): Promise<void> {
  const stripe = getStripe();
  const priceId = getStripePriceIdForPlan(plan);
  assert.ok(priceId, `price manquant pour ${plan}`);

  const customerId = await getOrCreateStripeCustomer({ userId, email });
  const pm = await stripe.paymentMethods.attach(VALID_PM, {
    customer: customerId,
  });
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: pm.id },
  });

  const sub = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    default_payment_method: pm.id,
    metadata: {
      docmind_user_id: userId,
      docmind_plan: plan,
      plan,
    },
    expand: ["items.data.price"],
  });

  await applyStripeSubscription(userId, sub, {
    id: `seed_${sub.id}`,
    type: "customer.subscription.created",
    created: Math.floor(Date.now() / 1000),
  });
}

async function testPaidToPaidDeclined() {
  const { userId, email, cleanup } = await createIsolatedUser();
  try {
    const startPlan: PaidBillingPlanId = "pro";
    const targetPlan: PaidBillingPlanId = "extra";
    await seedPaidSubscription(userId, email, startPlan);
    await syncUserSubscriptionFromStripe(userId);
    const before = await getUserSubscription(userId);
    assert.equal(before.plan, startPlan);

    const stripe = getStripe();
    assert.ok(before.stripeCustomerId, "customer requis");
    // Stripe refuse d’attacher pm_card_chargeDeclined / tok_chargeDeclined via API.
    // Retirer tout moyen de paiement → même effet : facture impayée, error_if_incomplete.
    await removeCustomerPaymentMethods(before.stripeCustomerId);

    let caught: unknown = null;
    try {
      await changeSubscriptionPlan({ userId, plan: targetPlan });
    } catch (e) {
      caught = e;
    }

    await syncUserSubscriptionFromStripe(userId);
    const after = await getUserSubscription(userId);
    const stripeSub = await stripe.subscriptions.retrieve(
      before.stripeSubscriptionId!,
      { expand: ["items.data.price"] },
    );
    const stripePlan = planIdFromStripePriceId(
      stripeSub.items.data[0]?.price?.id ?? null,
    );

    const invoices = await stripe.invoices.list({
      customer: before.stripeCustomerId,
      limit: 5,
    });
    const paidExtra = invoices.data.some(
      (inv) =>
        inv.status === "paid" &&
        Math.round((inv.amount_paid ?? 0) / 100) === 59.99 &&
        inv.created > Math.floor(Date.now() / 1000) - 120,
    );

    const errMsg =
      caught instanceof AppError
        ? caught.message
        : caught instanceof Error
          ? caught.message
          : String(caught ?? "");

    const ok =
      Boolean(caught) &&
      after.plan === startPlan &&
      stripePlan === startPlan &&
      stripeSub.status === "active" &&
      !paidExtra;

    log({
      scenario: "Pro → Extra payant (paiement impossible, équivalent refus carte)",
      verdict: ok ? "OK" : "KO",
      proof: ok
        ? `erreur levée, local=${after.plan}, stripe=${stripePlan}, pas de facture Extra payée — ${errMsg.slice(0, 100)}`
        : `error=${errMsg || "none"}, local ${before.plan}→${after.plan}, stripe=${stripePlan}, paidExtra=${paidExtra}`,
    });
  } finally {
    await cleanup();
  }
}

async function testFreeCheckoutSessionCreated() {
  const { userId, email, cleanup } = await createIsolatedUser();
  try {
    const before = await getUserSubscription(userId);
    assert.equal(before.plan, "free");

    const session = await createPlanCheckoutSession({
      userId,
      email,
      plan: "pro",
    });
    assert.equal(session.mode, "redirect");
    assert.ok(session.url?.includes("checkout.stripe.com"));

    const after = await getUserSubscription(userId);
    const ok = after.plan === "free" && !after.stripeSubscriptionId;

    log({
      scenario: "Free → Checkout (session créée, pas d’upgrade avant paiement)",
      verdict: ok ? "OK" : "KO",
      proof: ok
        ? `plan=free, checkout URL générée, pas d'abonnement actif`
        : `plan=${after.plan}, sub=${after.stripeSubscriptionId}`,
    });

    log({
      scenario: "Free → Checkout (carte 4000…0002 refusée sur UI Stripe)",
      verdict: "NON TESTÉ",
      proof:
        "Nécessite navigateur — voir guide ci-dessous. Session test: " +
        session.url!.slice(0, 60) +
        "…",
    });
  } finally {
    await cleanup();
  }
}

async function testStripePaymentErrorMapping() {
  const { toStripeBillingAppError } = await import(
    "../src/services/billing/stripe-payment-errors"
  );
  const err = toStripeBillingAppError({
    type: "StripeCardError",
    code: "card_declined",
    decline_code: "generic_decline",
    message: "Your card was declined.",
  });
  const ok =
    err.status === 402 &&
    /n.a pas été modifié/i.test(err.message) &&
    err.message.includes("generic_decline");
  log({
    scenario: "Message UI/API carte refusée (mapping stripe-payment-errors)",
    verdict: ok ? "OK" : "KO",
    proof: `"${err.message}"`,
  });
}

async function main() {
  assert.ok(isStripeConfigured(), "STRIPE_SECRET_KEY requis (mode test)");

  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key.startsWith("sk_test_")) {
    console.warn("WARN: STRIPE_SECRET_KEY n'est pas sk_test_ — arrêt.");
    process.exit(2);
  }

  await testStripePaymentErrorMapping();
  await testPaidToPaidDeclined();
  await testFreeCheckoutSessionCreated();

  console.log("=== RÉSUMÉ ===");
  for (const r of rows) {
    console.log(`${r.verdict.padEnd(10)} | ${r.scenario}`);
  }

  const ko = rows.some((r) => r.verdict === "KO");
  process.exit(ko ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
