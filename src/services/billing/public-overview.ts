import type { BillingOverview, UserSubscriptionRecord } from "@/types/billing";

/**
 * Vue client de l’abonnement : pas d’IDs Stripe bruts dans le navigateur.
 * Checkout / portal / sync côté serveur utilisent le store interne.
 */
export function toClientBillingSubscription(
  subscription: UserSubscriptionRecord,
): UserSubscriptionRecord & {
  hasStripeCustomer: boolean;
  hasStripeSubscription: boolean;
} {
  return {
    ...subscription,
    hasStripeCustomer: Boolean(subscription.stripeCustomerId),
    hasStripeSubscription: Boolean(subscription.stripeSubscriptionId),
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripePriceId: null,
    lastWebhookEventId: null,
    lastWebhookEventType: null,
    lastWebhookAt: null,
  };
}

export function toClientBillingOverview(
  overview: BillingOverview,
): BillingOverview & {
  subscription: ReturnType<typeof toClientBillingSubscription>;
} {
  return {
    ...overview,
    subscription: toClientBillingSubscription(overview.subscription),
  };
}
