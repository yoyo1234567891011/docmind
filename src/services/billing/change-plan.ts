import {
  getStripePriceIdForPlan,
  isPaidBillingPlanId,
} from "@/config/billing";
import { AppError } from "@/lib/errors";
import { withKeyedLock } from "@/lib/keyed-lock";
import { getStripe, requireStripeConfigured } from "@/lib/stripe";
import { resolveEffectivePlan } from "@/services/billing/access";
import { createPlanChangePortalSession } from "@/services/billing/portal-plan-change";
import { clearPendingDocmindAdjustmentItems } from "@/services/billing/renewal-catalog";
import { getUserSubscription } from "@/services/billing/store";
import { toStripeBillingAppError } from "@/services/billing/stripe-payment-errors";
import type {
  BillingImmediateInvoice,
  PaidBillingPlanId,
} from "@/types/billing";
import type Stripe from "stripe";

const SUBSCRIPTION_EXPAND = ["items.data.price"] as const;

export type ChangeSubscriptionPlanResult =
  | {
      outcome: "applied";
      plan: PaidBillingPlanId;
      immediateInvoice: BillingImmediateInvoice | null;
    }
  | {
      outcome: "action_required";
      url: string;
      targetPlan: PaidBillingPlanId;
      immediateInvoice: BillingImmediateInvoice | null;
    };

export function resolveBillableSubscriptionItem(
  stripeSub: Stripe.Subscription,
  hintPriceId?: string | null,
): Stripe.SubscriptionItem {
  const items = stripeSub.items?.data ?? [];
  if (items.length === 0) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Abonnement Stripe sans ligne de prix.",
      502,
    );
  }

  if (hintPriceId) {
    const match = items.find((entry) => {
      const priceId =
        typeof entry.price === "string" ? entry.price : entry.price?.id;
      return priceId === hintPriceId;
    });
    if (match) return match;
  }

  const first = items[0];
  if (!first?.id) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Abonnement Stripe sans ligne de prix.",
      502,
    );
  }
  return first;
}

/**
 * Classifie un état Stripe post-paiement (webhook / sync).
 * Conservé pour tests et retrieve settled — le change in-app ne charge plus
 * la carte en silence.
 */
export function classifyPlanChangePayment(input: {
  subscription: Stripe.Subscription;
  invoice: Stripe.Invoice | null;
  paymentIntent: Stripe.PaymentIntent | null;
}): "settled" | "action_required" | "failed" {
  const { subscription, invoice, paymentIntent: pi } = input;
  const pending = Boolean(subscription.pending_update);
  const due = invoice?.amount_due ?? 0;
  const invStatus = invoice?.status ?? null;

  if (pi) {
    if (
      pi.status === "requires_action" ||
      pi.status === "requires_confirmation"
    ) {
      return "action_required";
    }
    if (
      pi.status === "requires_payment_method" ||
      pi.status === "canceled"
    ) {
      return "failed";
    }
  }

  if (pending) {
    if (invStatus === "open" && due > 0) {
      return "action_required";
    }
    return "failed";
  }

  if (!invoice) return "settled";
  if (invStatus === "paid" || due <= 0) return "settled";
  if (pi?.status === "succeeded") return "settled";
  if (invStatus === "open" && due > 0) return "action_required";
  if (invStatus === "uncollectible" || invStatus === "void") return "failed";

  return "failed";
}

/**
 * Changement payant → payant : **toujours** via page Stripe
 * (Customer Portal `subscription_update_confirm`).
 *
 * - Prorata : `always_invoice` (config Portal DocMind)
 * - Aucun `subscriptions.update` / prélèvement silencieux côté app
 * - Plan local + quotas : uniquement après retour / webhook (payment gate)
 * - Abandon ou refus sur Stripe → plan inchangé
 */
export async function changeSubscriptionPlan(
  input: {
    userId: string;
    plan: PaidBillingPlanId;
  },
  options?: { skipLock?: boolean },
): Promise<ChangeSubscriptionPlanResult> {
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

  const execute = async (): Promise<ChangeSubscriptionPlanResult> => {
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

    if (!sub.stripeCustomerId) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Customer Stripe manquant pour le changement de plan.",
        502,
      );
    }

    const stripe = getStripe();

    try {
      await clearPendingDocmindAdjustmentItems(stripe, sub.stripeCustomerId);

      const stripeSub = await stripe.subscriptions.retrieve(
        sub.stripeSubscriptionId,
        { expand: [...SUBSCRIPTION_EXPAND] },
      );
      const item = resolveBillableSubscriptionItem(
        stripeSub,
        sub.stripePriceId,
      );

      const { url } = await createPlanChangePortalSession({
        customerId: sub.stripeCustomerId,
        subscriptionId: sub.stripeSubscriptionId,
        subscriptionItemId: item.id,
        newPriceId: priceId,
      });

      return {
        outcome: "action_required",
        url,
        targetPlan,
        immediateInvoice: null,
      };
    } catch (error) {
      throw toStripeBillingAppError(error);
    }
  };

  if (options?.skipLock) {
    return execute();
  }

  return withKeyedLock(`billing:checkout:${input.userId}`, execute);
}
