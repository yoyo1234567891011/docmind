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
  console.log("Résultat:", result);
  assert.equal(
    result.outcome,
    "action_required",
    "Attendu redirect Portal Stripe (pas de prélèvement silencieux)",
  );
  assert.ok(result.url, "URL Portal Stripe requise");
  assert.ok(
    /billing\.stripe\.com|stripe\.com/i.test(result.url),
    `URL Portal inattendue: ${result.url}`,
  );

  const after = await getUserSubscription(userId);
  console.log("Après (avant paiement Portal):", {
    plan: after.plan,
    currentPeriodEnd: after.currentPeriodEnd,
    portalUrl: result.url.slice(0, 80) + "…",
  });

  assert.equal(
    after.plan,
    before.plan,
    "Plan local inchangé tant que Portal non confirmé",
  );

  // Période conservée côté abo (pas encore modifié)
  if (periodEndBefore && after.currentPeriodEnd) {
    const periodEndAfter = Date.parse(after.currentPeriodEnd);
    const deltaDays = Math.abs(periodEndAfter - periodEndBefore) / 86_400_000;
    assert.ok(
      deltaDays < 2,
      `Ancre/période resetée ? delta=${deltaDays.toFixed(2)}j (attendu < 2)`,
    );
  }

  console.log(
    "OK : session Portal créée. Finaliser manuellement sur Stripe (4242 / 3220 / abandon).",
  );
  console.log("Preview prorata UI:", preview.immediateAmountDue);
  console.log("test-plan-change-proration: OK");
  console.log("Checklist Dashboard: scripts/checklist-plan-change-proration.md");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
