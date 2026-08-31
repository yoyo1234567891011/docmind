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
import { changeSubscriptionPlan } from "@/services/billing/change-plan";
import { getOrCreateStripeCustomer } from "@/services/billing/customers";
import { getUserSubscription } from "@/services/billing/store";
import type { BillingImmediateInvoice, PaidBillingPlanId } from "@/types/billing";

function canStartNewCheckout(status: string): boolean {
  return (
    status === "canceled" ||
    status === "incomplete" ||
    status === "incomplete_expired"
  );
}

export type PlanCheckoutResult =
  | { mode: "redirect"; url: string }
  | {
      mode: "changed";
      plan: PaidBillingPlanId;
      immediateInvoice: BillingImmediateInvoice | null;
    };

export async function createPlanCheckoutSession(input: {
  userId: string;
  email: string | null;
  plan: PaidBillingPlanId;
}): Promise<PlanCheckoutResult> {
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

    if (stillPaid) {
      const changed = await changeSubscriptionPlan(
        {
          userId: input.userId,
          plan,
        },
        { skipLock: true },
      );
      return {
        mode: "changed",
        plan: changed.plan,
        immediateInvoice: changed.immediateInvoice,
      };
    }

    if (sub.stripeSubscriptionId && !canStartNewCheckout(sub.status)) {
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

    return { mode: "redirect", url: session.url };
  });
}

/** @deprecated Prefer createPlanCheckoutSession({ plan: "pro" | ... }) */
export async function createPremiumCheckoutSession(input: {
  userId: string;
  email: string | null;
}): Promise<PlanCheckoutResult> {
  return createPlanCheckoutSession({ ...input, plan: "pro" });
}

export function parseCheckoutPlan(
  raw: unknown,
): PaidBillingPlanId | null {
  if (typeof raw !== "string") return null;
  const plan = normalizeBillingPlanId(raw);
  return isPaidBillingPlanId(plan) ? plan : null;
}
