import {
  getStripePriceIdForPlan,
  isPaidBillingPlanId,
  planIdFromStripePriceId,
} from "@/config/billing";
import { AppError } from "@/lib/errors";
import { getStripe } from "@/lib/stripe";
import {
  periodFromSubscription,
  readSubscriptionPriceId,
  toIso,
} from "@/services/billing/apply-subscription";
import { upsertSubscriptionPatch } from "@/services/billing/store";
import type { PaidBillingPlanId } from "@/types/billing";
import type Stripe from "stripe";

export async function releaseSubscriptionScheduleIfAny(
  stripe: ReturnType<typeof getStripe>,
  subscription: Stripe.Subscription,
): Promise<void> {
  const raw = subscription.schedule;
  if (!raw) return;
  const scheduleId = typeof raw === "string" ? raw : raw.id;
  if (!scheduleId) return;
  try {
    await stripe.subscriptionSchedules.release(scheduleId);
  } catch {
    // déjà released / inexistant
  }
}

/**
 * Programme un downgrade à `current_period_end` via Subscription Schedule.
 * Le price / plan local restent le plan haut jusqu’au webhook de bascule.
 */
export async function schedulePlanDowngrade(input: {
  userId: string;
  subscriptionId: string;
  targetPlan: PaidBillingPlanId;
}): Promise<{ effectiveAt: string; currentPlan: PaidBillingPlanId }> {
  const stripe = getStripe();
  const targetPriceId = getStripePriceIdForPlan(input.targetPlan);
  if (!targetPriceId) {
    throw new AppError(
      "BAD_REQUEST",
      `Price Stripe manquant pour le plan ${input.targetPlan}.`,
      503,
    );
  }

  const stripeSub = await stripe.subscriptions.retrieve(input.subscriptionId, {
    expand: ["items.data.price"],
  });
  const currentPriceId = readSubscriptionPriceId(stripeSub);
  if (!currentPriceId) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Abonnement Stripe sans price courant.",
      502,
    );
  }
  const currentPlan = planIdFromStripePriceId(currentPriceId);
  if (!isPaidBillingPlanId(currentPlan)) {
    throw new AppError(
      "BAD_REQUEST",
      "Downgrade réservé aux abonnements payants actifs.",
      400,
    );
  }
  if (currentPlan === input.targetPlan) {
    throw new AppError("BAD_REQUEST", "Vous êtes déjà sur ce plan.", 400);
  }

  const period = periodFromSubscription(stripeSub);
  const periodEndUnix =
    (stripeSub.items?.data?.[0] as { current_period_end?: number } | undefined)
      ?.current_period_end ??
    (stripeSub as { current_period_end?: number }).current_period_end;
  if (!periodEndUnix) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Fin de période Stripe introuvable pour programmer le downgrade.",
      502,
    );
  }
  const effectiveAt = period.end ?? toIso(periodEndUnix);
  if (!effectiveAt) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Date d’effet du downgrade introuvable.",
      502,
    );
  }

  // Remplace tout schedule existant.
  await releaseSubscriptionScheduleIfAny(stripe, stripeSub);

  const created = await stripe.subscriptionSchedules.create({
    from_subscription: input.subscriptionId,
  });

  const phase0 = created.phases[0];
  if (!phase0?.start_date || !phase0.end_date) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Schedule Stripe incomplet après from_subscription.",
      502,
    );
  }

  await stripe.subscriptionSchedules.update(created.id, {
    end_behavior: "release",
    proration_behavior: "none",
    phases: [
      {
        start_date: phase0.start_date,
        end_date: periodEndUnix,
        items: [{ price: currentPriceId, quantity: 1 }],
        proration_behavior: "none",
      },
      {
        items: [{ price: targetPriceId, quantity: 1 }],
        duration: { interval: "month", interval_count: 1 },
        proration_behavior: "none",
      },
    ],
    metadata: {
      docmind_user_id: input.userId,
      docmind_pending_plan: input.targetPlan,
      docmind_pending_plan_at: String(periodEndUnix),
    },
  });

  await stripe.subscriptions.update(input.subscriptionId, {
    metadata: {
      ...stripeSub.metadata,
      docmind_user_id: input.userId,
      docmind_pending_plan: input.targetPlan,
      docmind_pending_plan_at: String(periodEndUnix),
    },
  });

  await upsertSubscriptionPatch(input.userId, {
    pendingPlan: input.targetPlan,
    pendingPlanEffectiveAt: effectiveAt,
    // plan local inchangé (haut)
  });

  return { effectiveAt, currentPlan };
}

/** Annule un downgrade programmé (ex. avant upgrade Portal). */
export async function clearPendingDowngrade(input: {
  userId: string;
  subscriptionId: string;
}): Promise<void> {
  const stripe = getStripe();
  const stripeSub = await stripe.subscriptions.retrieve(input.subscriptionId);
  await releaseSubscriptionScheduleIfAny(stripe, stripeSub);
  await stripe.subscriptions.update(input.subscriptionId, {
    metadata: {
      ...stripeSub.metadata,
      docmind_pending_plan: "",
      docmind_pending_plan_at: "",
    },
  });
  await upsertSubscriptionPatch(input.userId, {
    pendingPlan: null,
    pendingPlanEffectiveAt: null,
  });
}
