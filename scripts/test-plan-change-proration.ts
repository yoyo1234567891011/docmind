/**
 * Vérifie un changement de plan en mode prorata Stripe (test).
 * Usage: npx tsx scripts/test-plan-change-proration.ts [email] [targetPlan]
 *
 * Prérequis : STRIPE_SECRET_KEY (sk_test_) + abonnement payant actif.
 * Ne compare PAS au prix catalogue plein.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

import { loadEnvFiles } from "./lib/load-env-files";

loadEnvFiles(process.cwd(), { override: true });
loadEnvFiles(process.cwd(), {
  override: true,
  files: [".env.cloud-beta.local", ".env.stripe-prices.local"],
});

import { getStripe, isStripeConfigured, isStripeLiveMode } from "../src/lib/stripe";
import { changeSubscriptionPlan } from "../src/services/billing/change-plan";
import { catalogPlanMonthlyEur } from "../src/services/billing/plan-change-full-price";
import { previewPlanChange } from "../src/services/billing/plan-change-preview";
import { getUserSubscription } from "../src/services/billing/store";
import { syncUserSubscriptionFromStripe } from "../src/services/billing/sync";
import type { PaidBillingPlanId } from "../src/types/billing";

const email = (process.argv[2] || "yoyo270709@gmail.com").trim().toLowerCase();
const targetArg = (process.argv[3] || "premium").trim().toLowerCase() as PaidBillingPlanId;

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
  assert.equal(
    isStripeLiveMode(),
    false,
    "Ce script est réservé au mode test Stripe (sk_test_).",
  );

  const userId = await findUserId();
  await syncUserSubscriptionFromStripe(userId);
  const before = await getUserSubscription(userId);
  console.log("Avant:", {
    plan: before.plan,
    status: before.status,
    stripeSubscriptionId: before.stripeSubscriptionId,
    currentPeriodEnd: before.currentPeriodEnd,
  });

  assert.ok(before.stripeSubscriptionId, "Abonnement Stripe requis");
  assert.notEqual(before.plan, targetArg, "Choisir un plan différent de l’actuel");

  const preview = await previewPlanChange(userId, targetArg);
  console.log("Preview prorata:", {
    immediateAmountDue: preview.immediateAmountDue,
    nextBillingDate: preview.nextBillingDate,
    catalogTarget: catalogPlanMonthlyEur(targetArg),
  });

  const periodEndBefore = before.currentPeriodEnd
    ? Date.parse(before.currentPeriodEnd)
    : null;

  const result = await changeSubscriptionPlan({ userId, plan: targetArg });
  console.log("Résultat:", {
    plan: result.plan,
    invoice: result.immediateInvoice,
  });

  assert.ok(result.immediateInvoice, "Facture immédiate attendue (always_invoice)");

  const stripe = getStripe();
  const invoice = await stripe.invoices.retrieve(result.immediateInvoice.id, {
    expand: ["lines.data"],
  });
  const amountPaid = (invoice.amount_paid ?? 0) / 100;
  const catalog = catalogPlanMonthlyEur(targetArg);
  const lines = invoice.lines?.data ?? [];
  const hasProrationLine = lines.some(
    (l) =>
      l.proration === true ||
      /unused|remaining|Unused|proration/i.test(l.description ?? ""),
  );

  console.log("Facture Stripe:", {
    id: invoice.id,
    status: invoice.status,
    amount_paid: amountPaid,
    catalogTarget: catalog,
    lineCount: lines.length,
    hasProrationLine,
    lines: lines.map((l) => ({
      amount: (l.amount ?? 0) / 100,
      proration: l.proration,
      description: l.description,
    })),
  });

  const after = await getUserSubscription(userId);
  console.log("Après:", {
    plan: after.plan,
    currentPeriodEnd: after.currentPeriodEnd,
  });

  assert.equal(after.plan, targetArg, "Plan local aligné");
  assert.ok(
    invoice.status === "paid" || invoice.amount_due === 0,
    `Facture non réglée: ${invoice.status}`,
  );

  // Période conservée (tolérance 2 jours — pas un reset +30j depuis now)
  if (periodEndBefore && after.currentPeriodEnd) {
    const periodEndAfter = Date.parse(after.currentPeriodEnd);
    const deltaDays = Math.abs(periodEndAfter - periodEndBefore) / 86_400_000;
    assert.ok(
      deltaDays < 2,
      `Ancre/période resetée ? delta=${deltaDays.toFixed(2)}j (attendu < 2)`,
    );
  }

  // Sur un upgrade mid-cycle, le plein catalogue est rare (sauf quasi jour 1)
  if (hasProrationLine && amountPaid > 0) {
    console.log(
      `OK prorata : prélèvement ${amountPaid} € (catalogue cible ${catalog} €)`,
    );
  } else if (!hasProrationLine) {
    console.warn(
      "WARN: aucune ligne proration détectée — vérifier le Dashboard (jour 1 du cycle ?).",
    );
  }

  console.log("test-plan-change-proration: OK");
  console.log("Checklist Dashboard: scripts/checklist-plan-change-proration.md");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
