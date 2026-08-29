import {
  getStripePriceIdForPlan,
  isPaidBillingPlanId,
  planIdFromStripePriceId,
} from "@/config/billing";
import { AppError } from "@/lib/errors";
import { withKeyedLock } from "@/lib/keyed-lock";
import { getStripe, requireStripeConfigured } from "@/lib/stripe";
import {
  applyStripeSubscription,
  planFromSubscription,
  readSubscriptionPriceId,
} from "@/services/billing/apply-subscription";
import { resolveEffectivePlan } from "@/services/billing/access";
import { getUserSubscription } from "@/services/billing/store";
import type { PaidBillingPlanId } from "@/types/billing";
import type Stripe from "stripe";

const SUBSCRIPTION_EXPAND = ["items.data.price"] as const;

function resolveBillableSubscriptionItem(
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

async function retrieveSubscriptionHydrated(
  stripe: ReturnType<typeof getStripe>,
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.retrieve(subscriptionId, {
    expand: [...SUBSCRIPTION_EXPAND],
  });
}

function assertStripePlanMatches(
  sub: Stripe.Subscription,
  targetPlan: PaidBillingPlanId,
): void {
  const priceId = readSubscriptionPriceId(sub);
  const fromPrice = planIdFromStripePriceId(priceId);
  if (fromPrice === targetPlan) return;

  const fromCatalog = planFromSubscription(sub);
  if (fromCatalog === targetPlan) return;

  throw new AppError(
    "INTERNAL_ERROR",
    `Stripe n'a pas confirmé le plan ${targetPlan} (price actuel : ${priceId ?? "inconnu"}). Réessayez ou contactez le support.`,
    502,
  );
}

/**
 * Change le price Stripe d’un abonnement existant (upgrade / downgrade).
 * N’applique le plan local qu’après confirmation du price côté Stripe.
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
    const stripeSub = await retrieveSubscriptionHydrated(
      stripe,
      sub.stripeSubscriptionId,
    );
    const item = resolveBillableSubscriptionItem(
      stripeSub,
      sub.stripePriceId,
    );

    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
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

    const verified = await retrieveSubscriptionHydrated(
      stripe,
      sub.stripeSubscriptionId,
    );
    assertStripePlanMatches(verified, targetPlan);

    await applyStripeSubscription(input.userId, verified, {
      id: `plan_change_${verified.id}_${targetPlan}_${readSubscriptionPriceId(verified) ?? "na"}`,
      type: "customer.subscription.updated",
      created: Math.floor(Date.now() / 1000),
    });

    const appliedPlan = planFromSubscription(verified);
    if (!isPaidBillingPlanId(appliedPlan) || appliedPlan !== targetPlan) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Synchronisation locale incohérente après changement Stripe.",
        502,
      );
    }

    return { plan: appliedPlan };
  };

  if (options?.skipLock) {
    return execute();
  }

  return withKeyedLock(`billing:checkout:${input.userId}`, execute);
}
