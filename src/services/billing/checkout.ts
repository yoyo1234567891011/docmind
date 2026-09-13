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

/** Statuts Stripe qui bloquent un nouveau Checkout (éviter double abo / double charge). */
const CHECKOUT_BLOCKING_STRIPE_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
]);

const EXISTING_SUB_CHECKOUT_MSG =
  "Un abonnement Stripe existe déjà. Gérez-le depuis Facturation (portail) — aucun nouveau Checkout n’est ouvert.";

async function assertNoBlockingStripeSubscription(
  customerId: string,
): Promise<void> {
  const stripe = getStripe();
  const list = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 20,
  });
  const blocking = list.data.find((s) =>
    CHECKOUT_BLOCKING_STRIPE_STATUSES.has(s.status),
  );
  if (blocking) {
    throw new AppError("BAD_REQUEST", EXISTING_SUB_CHECKOUT_MSG, 400);
  }
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
      throw new AppError("BAD_REQUEST", EXISTING_SUB_CHECKOUT_MSG, 400);
    }

    const customerId = await getOrCreateStripeCustomer({
      userId: input.userId,
      email: input.email,
    });

    // Garde Stripe (DB locale peut être stale après 1er Checkout non webhooké).
    await assertNoBlockingStripeSubscription(customerId);

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
