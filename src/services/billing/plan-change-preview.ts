import { getBillingPlan, getStripePriceIdForPlan } from "@/config/billing";
import { AppError } from "@/lib/errors";
import { getStripe, requireStripeConfigured } from "@/lib/stripe";
import { resolveEffectivePlan } from "@/services/billing/access";
import { resolveBillableSubscriptionItem } from "@/services/billing/change-plan";
import { getUserSubscription } from "@/services/billing/store";
import type {
  BillingPlanChangePreview,
  PaidBillingPlanId,
} from "@/types/billing";

function toIso(unix: number | null | undefined): string | null {
  if (!unix) return null;
  return new Date(unix * 1000).toISOString();
}

function centsToUnits(cents: number | null | undefined): number {
  return (cents ?? 0) / 100;
}

function unavailablePreview(
  currentPlanId: BillingPlanChangePreview["currentPlan"],
  targetPlan: PaidBillingPlanId,
  note: string,
): BillingPlanChangePreview {
  const current = getBillingPlan(currentPlanId);
  const target = getBillingPlan(targetPlan);
  return {
    currentPlan: currentPlanId,
    targetPlan,
    currentPlanName: current.name,
    targetPlanName: target.name,
    currentMonthlyEur: current.priceMonthlyEur,
    targetMonthlyEur: target.priceMonthlyEur,
    immediateAmountDue: null,
    currency: "EUR",
    isUpgrade: (target.priceMonthlyEur ?? 0) > (current.priceMonthlyEur ?? 0),
    nextBillingDate: null,
    nextMonthlyEur: target.priceMonthlyEur,
    available: false,
    note,
  };
}

/**
 * Estimation Stripe du prélèvement immédiat (always_invoice) avant changement de plan.
 */
export async function previewPlanChange(
  userId: string,
  targetPlan: PaidBillingPlanId,
): Promise<BillingPlanChangePreview> {
  requireStripeConfigured();

  const sub = await getUserSubscription(userId);
  const currentPlan = resolveEffectivePlan(sub.plan, sub.status, {
    currentPeriodEnd: sub.currentPeriodEnd,
  });

  if (!sub.stripeCustomerId || !sub.stripeSubscriptionId) {
    return unavailablePreview(
      currentPlan,
      targetPlan,
      "Utilisez le checkout pour souscrire un premier abonnement.",
    );
  }

  if (currentPlan === targetPlan) {
    throw new AppError("BAD_REQUEST", "Vous êtes déjà sur ce plan.", 400);
  }

  const priceId = getStripePriceIdForPlan(targetPlan);
  if (!priceId) {
    return unavailablePreview(
      currentPlan,
      targetPlan,
      `Price Stripe manquant pour le plan ${targetPlan}.`,
    );
  }

  const currentDef = getBillingPlan(currentPlan);
  const targetDef = getBillingPlan(targetPlan);
  const isUpgrade =
    (targetDef.priceMonthlyEur ?? 0) > (currentDef.priceMonthlyEur ?? 0);

  const stripe = getStripe();
  const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId, {
    expand: ["items.data.price"],
  });
  const item = resolveBillableSubscriptionItem(stripeSub, sub.stripePriceId);

  try {
    const preview = await stripe.invoices.createPreview({
      customer: sub.stripeCustomerId,
      subscription: sub.stripeSubscriptionId,
      subscription_details: {
        items: [{ id: item.id, price: priceId }],
        proration_behavior: "always_invoice",
      },
    });

    return {
      currentPlan,
      targetPlan,
      currentPlanName: currentDef.name,
      targetPlanName: targetDef.name,
      currentMonthlyEur: currentDef.priceMonthlyEur,
      targetMonthlyEur: targetDef.priceMonthlyEur,
      immediateAmountDue: centsToUnits(preview.amount_due),
      currency: (preview.currency || "eur").toUpperCase(),
      isUpgrade,
      nextBillingDate: sub.currentPeriodEnd,
      nextMonthlyEur: targetDef.priceMonthlyEur,
      available: true,
      note: null,
    };
  } catch {
    return {
      currentPlan,
      targetPlan,
      currentPlanName: currentDef.name,
      targetPlanName: targetDef.name,
      currentMonthlyEur: currentDef.priceMonthlyEur,
      targetMonthlyEur: targetDef.priceMonthlyEur,
      immediateAmountDue: null,
      currency: "EUR",
      isUpgrade,
      nextBillingDate: sub.currentPeriodEnd,
      nextMonthlyEur: targetDef.priceMonthlyEur,
      available: false,
      note:
        "Estimation du prélèvement immédiat indisponible — un paiement au prorata peut être prélevé dès la confirmation.",
    };
  }
}
