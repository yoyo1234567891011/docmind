import { getBillingPlan, getStripePriceIdForPlan, isPlanTierUpgrade } from "@/config/billing";
import { AppError } from "@/lib/errors";
import { getStripe, requireStripeConfigured } from "@/lib/stripe";
import { resolveEffectivePlan } from "@/services/billing/access";
import { periodFromSubscription } from "@/services/billing/apply-subscription";
import { resolveBillableSubscriptionItem } from "@/services/billing/change-plan";
import { PLAN_CHANGE_PREVIEW_SUBSCRIPTION_DETAILS } from "@/services/billing/plan-change-full-price";
import { getUserSubscription } from "@/services/billing/store";
import type {
  BillingPlanChangePreview,
  PaidBillingPlanId,
} from "@/types/billing";

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
    deferredToPeriodEnd: false,
    nextBillingDate: null,
    nextMonthlyEur: target.priceMonthlyEur,
    available: false,
    note,
  };
}

/**
 * Aperçu avant changement payant → payant : montant = prorata Stripe (preview invoice).
 * nextBillingDate = fin de période **abonnement** (pas invoice.period_end du prorata).
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
  const isUpgrade = isPlanTierUpgrade(currentPlan, targetPlan);
  const deferredToPeriodEnd = !isUpgrade;

  let immediateAmountDue: number | null = null;
  // Vérité renouvellement = période abo (page Facturation), jamais la fenêtre prorata.
  let nextBillingDate = sub.currentPeriodEnd;

  try {
    const stripe = getStripe();
    const stripeSub = await stripe.subscriptions.retrieve(
      sub.stripeSubscriptionId,
      { expand: ["items.data.price"] },
    );
    const period = periodFromSubscription(stripeSub);
    if (period.end) nextBillingDate = period.end;

    if (isUpgrade) {
      const item = resolveBillableSubscriptionItem(stripeSub, sub.stripePriceId);
      const preview = await stripe.invoices.createPreview({
        customer: sub.stripeCustomerId,
        subscription: sub.stripeSubscriptionId,
        subscription_details: {
          items: [{ id: item.id, price: priceId }],
          ...PLAN_CHANGE_PREVIEW_SUBSCRIPTION_DETAILS,
        },
      });
      immediateAmountDue = Math.max(0, (preview.amount_due ?? 0) / 100);
    } else {
      immediateAmountDue = 0;
    }
  } catch {
    if (deferredToPeriodEnd) immediateAmountDue = 0;
  }

  return {
    currentPlan,
    targetPlan,
    currentPlanName: currentDef.name,
    targetPlanName: targetDef.name,
    currentMonthlyEur: currentDef.priceMonthlyEur,
    targetMonthlyEur: targetDef.priceMonthlyEur,
    immediateAmountDue,
    currency: "EUR",
    isUpgrade,
    deferredToPeriodEnd,
    nextBillingDate,
    nextMonthlyEur: targetDef.priceMonthlyEur,
    available: true,
    note: deferredToPeriodEnd
      ? `Le passage à ${targetDef.name} prend effet à la fin de période — jusqu’à cette date vous restez sur ${currentDef.name}.`
      : null,
  };
}
