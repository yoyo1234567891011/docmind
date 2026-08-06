import { getStripe, requireStripeConfigured } from "@/lib/stripe";
import { trackAnalyticsEvent } from "@/services/analytics";
import { applyStripeSubscription } from "@/services/billing/apply-subscription";
import { getUserSubscription } from "@/services/billing/store";
import { AppError } from "@/lib/errors";

/**
 * Annulation en fin de période (recommandé) ou immédiate.
 * Met à jour immédiatement la base locale (sans attendre le webhook).
 */
export async function cancelPremiumSubscription(input: {
  userId: string;
  immediately?: boolean;
}): Promise<{
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
}> {
  requireStripeConfigured();

  const sub = await getUserSubscription(input.userId);
  if (!sub.stripeSubscriptionId) {
    throw new AppError(
      "BAD_REQUEST",
      "Aucun abonnement Premium Stripe actif.",
      400,
    );
  }

  const stripe = getStripe();
  const now = Math.floor(Date.now() / 1000);

  const mode = input.immediately ? "immediate" : "period_end";

  if (input.immediately) {
    const canceled = await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
    await trackAnalyticsEvent({
      name: "billing.cancel_requested",
      userId: input.userId,
      idempotencyKey: `billing.cancel_requested:${canceled.id}:immediate:${canceled.canceled_at ?? now}`,
      meta: {
        plan: "premium",
        mode,
        source: "billing_cancel_api",
        stripeSubscriptionId: canceled.id,
      },
    });
    await applyStripeSubscription(input.userId, canceled, {
      id: `cancel_immediate_${canceled.id}`,
      type: "customer.subscription.deleted",
      created: now,
    });
    return {
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    };
  }

  const updated = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  const cancelAt =
    typeof updated.cancel_at === "number" ? updated.cancel_at : now;
  await trackAnalyticsEvent({
    name: "billing.cancel_requested",
    userId: input.userId,
    idempotencyKey: `billing.cancel_requested:${updated.id}:period_end:${cancelAt}`,
    meta: {
      plan: "premium",
      mode,
      source: "billing_cancel_api",
      stripeSubscriptionId: updated.id,
    },
  });

  await applyStripeSubscription(input.userId, updated, {
    id: `cancel_period_end_${updated.id}`,
    type: "customer.subscription.updated",
    created: now,
  });

  const local = await getUserSubscription(input.userId);
  return {
    cancelAtPeriodEnd: true,
    currentPeriodEnd: local.currentPeriodEnd,
  };
}

export async function resumePremiumSubscription(userId: string): Promise<void> {
  requireStripeConfigured();
  const sub = await getUserSubscription(userId);
  if (!sub.stripeSubscriptionId) {
    throw new AppError("BAD_REQUEST", "Aucun abonnement à reprendre.", 400);
  }

  const stripe = getStripe();
  // clear cancel_at_period_end ET cancel_at (portail Stripe utilise souvent cancel_at)
  const updated = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    cancel_at_period_end: false,
    cancel_at: "",
  });

  await applyStripeSubscription(userId, updated, {
    id: `resume_${updated.id}`,
    type: "customer.subscription.updated",
    created: Math.floor(Date.now() / 1000),
  });
}
