import {
  getAppBaseUrl,
  getStripePremiumPriceId,
} from "@/config/billing";
import { AppError } from "@/lib/errors";
import { withKeyedLock } from "@/lib/keyed-lock";
import { getStripe, requireStripeConfigured } from "@/lib/stripe";
import { trackAnalyticsEvent } from "@/services/analytics";
import { hasPremiumAccess } from "@/services/billing/access";
import { getOrCreateStripeCustomer } from "@/services/billing/customers";
import { getUserSubscription } from "@/services/billing/store";

export async function createPremiumCheckoutSession(input: {
  userId: string;
  email: string | null;
}): Promise<{ url: string }> {
  requireStripeConfigured();

  const priceId = getStripePremiumPriceId();
  if (!priceId) {
    throw new AppError(
      "BAD_REQUEST",
      "STRIPE_PRICE_PREMIUM manquant.",
      503,
    );
  }

  // Mutex + relecture : évite double session / double customer.
  return withKeyedLock(`billing:checkout:${input.userId}`, async () => {
    const sub = await getUserSubscription(input.userId);
    const stillPremium = hasPremiumAccess(sub.plan, sub.status, {
      currentPeriodEnd: sub.currentPeriodEnd,
    });

    if (stillPremium && sub.cancelAtPeriodEnd) {
      throw new AppError(
        "BAD_REQUEST",
        "Votre Premium est encore actif jusqu’à la fin de période. Réactivez le renouvellement depuis Facturation (ou le portail Stripe) au lieu de créer un nouvel abonnement.",
        400,
      );
    }

    if (stillPremium) {
      throw new AppError(
        "BAD_REQUEST",
        "Vous êtes déjà abonné à Premium.",
        400,
      );
    }

    if (sub.stripeSubscriptionId && sub.status !== "canceled") {
      throw new AppError(
        "BAD_REQUEST",
        "Un abonnement Stripe est déjà ouvert. Gérez-le depuis Facturation.",
        400,
      );
    }

    const customerId = await getOrCreateStripeCustomer({
      userId: input.userId,
      email: input.email,
    });

    const stripe = getStripe();
    const baseUrl = getAppBaseUrl();
    const idempotencyKey = `checkout:${input.userId}:${priceId}:${sub.updatedAt ?? "na"}`;

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}/facturation?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/facturation?checkout=cancel`,
        client_reference_id: input.userId,
        metadata: {
          docmind_user_id: input.userId,
          plan: "premium",
        },
        subscription_data: {
          metadata: {
            docmind_user_id: input.userId,
            plan: "premium",
          },
        },
        allow_promotion_codes: true,
        billing_address_collection: "auto",
      },
      { idempotencyKey },
    );

    if (!session.url) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Impossible de créer la session Checkout Stripe.",
        502,
      );
    }

    await trackAnalyticsEvent({
      name: "billing.checkout_started",
      userId: input.userId,
      idempotencyKey: `billing.checkout_started:${session.id}`,
      meta: {
        plan: "premium",
        source: "checkout_api",
        sessionId: session.id,
      },
    });

    return { url: session.url };
  });
}
