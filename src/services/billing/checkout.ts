import {
  getAppBaseUrl,
  getStripePriceIdForPlan,
  isPaidBillingPlanId,
  normalizeBillingPlanId,
} from "@/config/billing";
import { AppError } from "@/lib/errors";
import { withKeyedLock } from "@/lib/keyed-lock";
import { getStripe, requireStripeConfigured } from "@/lib/stripe";
import { trackAnalyticsEvent } from "@/services/analytics";
import { hasPaidAccess } from "@/services/billing/access";
import { getOrCreateStripeCustomer } from "@/services/billing/customers";
import { getUserSubscription } from "@/services/billing/store";
import type { PaidBillingPlanId } from "@/types/billing";

export async function createPlanCheckoutSession(input: {
  userId: string;
  email: string | null;
  plan: PaidBillingPlanId;
}): Promise<{ url: string }> {
  requireStripeConfigured();

  const plan = input.plan;
  if (!isPaidBillingPlanId(plan)) {
    throw new AppError("BAD_REQUEST", "Plan Stripe invalide.", 400);
  }

  const priceId = getStripePriceIdForPlan(plan);
  if (!priceId) {
    throw new AppError(
      "BAD_REQUEST",
      `Price Stripe manquant pour le plan ${plan}.`,
      503,
    );
  }

  return withKeyedLock(`billing:checkout:${input.userId}`, async () => {
    const sub = await getUserSubscription(input.userId);
    const stillPaid = hasPaidAccess(sub.plan, sub.status, {
      currentPeriodEnd: sub.currentPeriodEnd,
    });

    if (stillPaid && sub.cancelAtPeriodEnd) {
      throw new AppError(
        "BAD_REQUEST",
        "Votre abonnement est encore actif jusqu’à la fin de période. Réactivez le renouvellement depuis Facturation (ou le portail Stripe) au lieu de créer un nouvel abonnement.",
        400,
      );
    }

    if (stillPaid) {
      throw new AppError(
        "BAD_REQUEST",
        "Vous avez déjà un abonnement actif. Gérez-le depuis Facturation ou le portail Stripe (changement d’offre).",
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
          plan,
          docmind_plan: plan,
        },
        subscription_data: {
          metadata: {
            docmind_user_id: input.userId,
            plan,
            docmind_plan: plan,
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
        plan,
        source: "checkout_api",
        sessionId: session.id,
      },
    });

    return { url: session.url };
  });
}

/** @deprecated Prefer createPlanCheckoutSession({ plan: "pro" | ... }) */
export async function createPremiumCheckoutSession(input: {
  userId: string;
  email: string | null;
}): Promise<{ url: string }> {
  return createPlanCheckoutSession({ ...input, plan: "pro" });
}

export function parseCheckoutPlan(
  raw: unknown,
): PaidBillingPlanId | null {
  if (typeof raw !== "string") return null;
  const plan = normalizeBillingPlanId(raw);
  return isPaidBillingPlanId(plan) ? plan : null;
}
