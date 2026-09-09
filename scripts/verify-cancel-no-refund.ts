/**
 * Vérifie qu'une annulation DocMind ne déclenche pas de remboursement Stripe.
 */
import { loadEnvFiles } from "./lib/load-env-files";
loadEnvFiles(process.cwd(), { override: true });

import { getStripe } from "../src/lib/stripe";
import { cancelPremiumSubscription } from "../src/services/billing/cancel";
import { getUserSubscription } from "../src/services/billing/store";

const userId = process.argv[2] || "70ca281b-6195-4145-afab-d8969f0da46c";

async function refundTotalForCustomer(customerId: string): Promise<number> {
  const stripe = getStripe();
  let total = 0;
  let startingAfter: string | undefined;
  for (;;) {
    const page = await stripe.refunds.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const r of page.data) {
      const chargeId =
        typeof r.charge === "string" ? r.charge : r.charge?.id ?? null;
      if (!chargeId) continue;
      const charge = await stripe.charges.retrieve(chargeId);
      const cust =
        typeof charge.customer === "string"
          ? charge.customer
          : charge.customer?.id;
      if (cust === customerId) total += r.amount ?? 0;
    }
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1]?.id;
  }
  return total;
}

async function main() {
  const stripe = getStripe();
  const before = await getUserSubscription(userId);
  if (!before.stripeCustomerId || !before.stripeSubscriptionId) {
    console.error("Pas de customer/subscription Stripe pour", userId);
    process.exit(1);
  }

  const refundsBefore = await refundTotalForCustomer(before.stripeCustomerId);
  console.log("Refunds cumulés avant (centimes):", refundsBefore);

  const subBefore = await stripe.subscriptions.retrieve(
    before.stripeSubscriptionId,
  );
  console.log("Avant annulation:", {
    status: subBefore.status,
    cancel_at_period_end: subBefore.cancel_at_period_end,
  });

  await cancelPremiumSubscription({ userId, immediately: false });

  const subAfter = await stripe.subscriptions.retrieve(
    before.stripeSubscriptionId,
  );
  const refundsAfter = await refundTotalForCustomer(before.stripeCustomerId);

  console.log("Après annulation (fin de période):", {
    status: subAfter.status,
    cancel_at_period_end: subAfter.cancel_at_period_end,
    current_period_end: subAfter.items?.data?.[0]?.current_period_end
      ? new Date(
          (subAfter.items.data[0] as { current_period_end: number })
            .current_period_end * 1000,
        ).toISOString()
      : null,
  });
  console.log("Refunds cumulés après (centimes):", refundsAfter);

  if (refundsAfter > refundsBefore) {
    console.error("FAIL: un remboursement Stripe a été créé à l'annulation");
    process.exit(1);
  }

  // Reprendre pour ne pas laisser le compte en annulation planifiée
  const { resumePremiumSubscription } = await import(
    "../src/services/billing/cancel"
  );
  await resumePremiumSubscription(userId);
  console.log("\nOK — annulation fin de période sans remboursement automatique");
}

main().catch((e) => {
  console.error("FAIL:", e?.message ?? e);
  process.exit(1);
});
