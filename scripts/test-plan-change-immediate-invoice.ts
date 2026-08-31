/**
 * Vérifie que Pro→Extra (ou inverse) crée une facture immédiate côté Stripe.
 * Usage: npx tsx scripts/test-plan-change-immediate-invoice.ts [email] [targetPlan]
 *
 * Prérequis : STRIPE_SECRET_KEY + abonnement payant actif sur le compte.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

import { loadEnvFiles } from "./lib/load-env-files";

loadEnvFiles(process.cwd(), { override: true });
loadEnvFiles(process.cwd(), {
  override: true,
  files: [".env.cloud-beta.local", ".env.stripe-prices.local"],
});

import { getStripe, isStripeConfigured } from "../src/lib/stripe";
import { changeSubscriptionPlan } from "../src/services/billing/change-plan";
import { catalogPlanMonthlyEur } from "../src/services/billing/plan-change-full-price";
import { previewPlanChange } from "../src/services/billing/plan-change-preview";
import { getUserSubscription } from "../src/services/billing/store";
import { syncUserSubscriptionFromStripe } from "../src/services/billing/sync";
import type { PaidBillingPlanId } from "../src/types/billing";

const email = (process.argv[2] || "yoyo270709@gmail.com").trim().toLowerCase();
const targetArg = (process.argv[3] || "extra").trim().toLowerCase() as PaidBillingPlanId;

async function findUserId(): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  assert.ok(url && service, "Supabase admin requis");
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
    assert.ok(data.users.length < 200, `Utilisateur introuvable: ${email}`);
    page += 1;
  }
}

async function main() {
  assert.ok(isStripeConfigured(), "STRIPE_SECRET_KEY requis");

  const userId = await findUserId();
  await syncUserSubscriptionFromStripe(userId);
  const before = await getUserSubscription(userId);
  console.log("Avant:", {
    plan: before.plan,
    status: before.status,
    stripeSubscriptionId: before.stripeSubscriptionId,
    stripePriceId: before.stripePriceId,
  });

  assert.ok(before.stripeSubscriptionId, "Abonnement Stripe requis");

  const preview = await previewPlanChange(userId, targetArg);
  console.log("Preview:", preview);

  const result = await changeSubscriptionPlan({ userId, plan: targetArg });
  console.log("Résultat changement:", result);

  assert.ok(result.immediateInvoice, "Facture immédiate attendue");
  assert.ok(
    result.immediateInvoice.id.startsWith("in_"),
    "ID facture Stripe invalide",
  );

  const stripe = getStripe();
  const invoice = await stripe.invoices.retrieve(result.immediateInvoice.id);
  const expectedCatalog = catalogPlanMonthlyEur(targetArg);
  const amountPaid = (invoice.amount_paid ?? 0) / 100;
  console.log("Facture Stripe:", {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    subtotal: (invoice.subtotal ?? 0) / 100,
    amount_due: (invoice.amount_due ?? 0) / 100,
    amount_paid: amountPaid,
    starting_balance: (invoice.starting_balance ?? 0) / 100,
    expectedCatalog,
  });

  const after = await getUserSubscription(userId);
  console.log("Après:", {
    plan: after.plan,
    stripePriceId: after.stripePriceId,
  });

  assert.equal(after.plan, targetArg, "Plan local aligné");
  assert.ok(
    invoice.status === "paid" || invoice.amount_due === 0,
    `Facture non réglée: ${invoice.status}`,
  );
  assert.equal(invoice.starting_balance ?? 0, 0, "Solde client ne doit pas réduire le prélèvement");
  assert.ok(
    Math.abs(amountPaid - expectedCatalog) <= 0.05,
    `Prélèvement ${amountPaid} € ≠ catalogue ${expectedCatalog} €`,
  );

  console.log("test-plan-change-immediate-invoice: OK");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
