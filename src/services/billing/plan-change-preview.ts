import { getBillingPlan, getStripePriceIdForPlan } from "@/config/billing";
import { AppError } from "@/lib/errors";
import { getStripe, requireStripeConfigured } from "@/lib/stripe";
import { resolveEffectivePlan } from "@/services/billing/access";
import { resolveBillableSubscriptionItem } from "@/services/billing/change-plan";
import {
  catalogPlanMonthlyEur,
  PLAN_CHANGE_PREVIEW_SUBSCRIPTION_DETAILS,
} from "@/services/billing/plan-change-full-price";
import { getUserSubscription } from "@/services/billing/store";
import type {
  BillingPlanChangePreview,
  PaidBillingPlanId,
} from "@/types/billing";

function toIso(unix: number | null | undefined): string | null {
  if (!unix) return null;
  return new Date(unix * 1000).toISOString();
}

function estimateNextBillingDate(): string {
  const next = new Date();
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next.toISOString();
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
 * Aperçu avant changement payant → payant : montant = prix catalogue du plan cible.
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
  const catalogCharge = catalogPlanMonthlyEur(targetPlan);
  const isUpgrade =
    (targetDef.priceMonthlyEur ?? 0) > (currentDef.priceMonthlyEur ?? 0);

  let nextBillingDate = estimateNextBillingDate();

  try {
    const stripe = getStripe();
    const stripeSub = await stripe.subscriptions.retrieve(
      sub.stripeSubscriptionId,
      { expand: ["items.data.price"] },
    );
    const item = resolveBillableSubscriptionItem(stripeSub, sub.stripePriceId);
    const preview = await stripe.invoices.createPreview({
      customer: sub.stripeCustomerId,
      subscription: sub.stripeSubscriptionId,
      subscription_details: {
        items: [{ id: item.id, price: priceId }],
        ...PLAN_CHANGE_PREVIEW_SUBSCRIPTION_DETAILS,
      },
    });
    nextBillingDate = toIso(preview.period_end) ?? nextBillingDate;
  } catch {
    // garde l’estimation catalogue + date +1 mois
  }

  return {
    currentPlan,
    targetPlan,
    currentPlanName: currentDef.name,
    targetPlanName: targetDef.name,
    currentMonthlyEur: currentDef.priceMonthlyEur,
    targetMonthlyEur: targetDef.priceMonthlyEur,
    immediateAmountDue: catalogCharge,
    currency: "EUR",
    isUpgrade,
    nextBillingDate,
    nextMonthlyEur: targetDef.priceMonthlyEur,
    available: true,
    note: null,
  };
}
