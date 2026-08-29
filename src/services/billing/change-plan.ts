import {
  getStripePriceIdForPlan,
  isPaidBillingPlanId,
} from "@/config/billing";
import { AppError } from "@/lib/errors";
import { withKeyedLock } from "@/lib/keyed-lock";
import { getStripe, requireStripeConfigured } from "@/lib/stripe";
import { resolveEffectivePlan } from "@/services/billing/access";
import { applyStripeSubscription } from "@/services/billing/apply-subscription";
import { getUserSubscription } from "@/services/billing/store";
import type { PaidBillingPlanId } from "@/types/billing";

/**
 * Change le price Stripe d’un abonnement existant (upgrade / downgrade).
 * Applique immédiatement l’état local via applyStripeSubscription.
 */
export async function changeSubscriptionPlan(
  input: {
    userId: string;
    plan: PaidBillingPlanId;
  },
  options?: { skipLock?: boolean },
): Promise<{ plan: PaidBillingPlanId }> {
  requireStripeConfigured();

  const targetPlan = input.plan;
  if (!isPaidBillingPlanId(targetPlan)) {
    throw new AppError("BAD_REQUEST", "Plan Stripe invalide.", 400);
  }

  const priceId = getStripePriceIdForPlan(targetPlan);
  if (!priceId) {
    throw new AppError(
      "BAD_REQUEST",
      `Price Stripe manquant pour le plan ${targetPlan}.`,
      503,
    );
  }

  const execute = async (): Promise<{ plan: PaidBillingPlanId }> => {
    const sub = await getUserSubscription(input.userId);
    if (!sub.stripeSubscriptionId) {
      throw new AppError(
        "BAD_REQUEST",
        "Aucun abonnement actif à modifier. Utilisez le checkout.",
        400,
      );
    }

    const currentPlan = resolveEffectivePlan(sub.plan, sub.status, {
      currentPeriodEnd: sub.currentPeriodEnd,
    });
    if (currentPlan === targetPlan) {
      throw new AppError("BAD_REQUEST", "Vous êtes déjà sur ce plan.", 400);
    }

    const stripe = getStripe();
    const stripeSub = await stripe.subscriptions.retrieve(
      sub.stripeSubscriptionId,
    );
    const item = stripeSub.items.data[0];
    if (!item?.id) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Abonnement Stripe sans ligne de prix.",
        502,
      );
    }

    const updated = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: "create_prorations",
      cancel_at_period_end: false,
      metadata: {
        ...stripeSub.metadata,
        docmind_user_id: input.userId,
        docmind_plan: targetPlan,
        plan: targetPlan,
      },
    });

    await applyStripeSubscription(input.userId, updated, {
      id: `plan_change_${updated.id}_${targetPlan}`,
      type: "customer.subscription.updated",
      created: Math.floor(Date.now() / 1000),
    });

    return { plan: targetPlan };
  };

  if (options?.skipLock) {
    return execute();
  }

  return withKeyedLock(`billing:checkout:${input.userId}`, execute);
}
