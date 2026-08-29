import type Stripe from "stripe";

import {
  areStripePaidPricesConfigured,
  isPaidBillingPlanId,
  isPlanTierUpgrade,
  normalizeBillingPlanId,
  planIdFromStripePriceId,
} from "@/config/billing";
import { trackAnalyticsEvent } from "@/services/analytics";
import { resolveEffectivePlan } from "@/services/billing/access";
import {
  getUserSubscription,
  upsertSubscriptionPatch,
} from "@/services/billing/store";
import { resetQuotasOnPlanUpgrade } from "@/services/quotas/upgrade-reset";
import type {
  BillingPlanId,
  BillingSubscriptionStatus,
} from "@/types/billing";

export function toIso(unix: number | null | undefined): string | null {
  if (!unix) return null;
  return new Date(unix * 1000).toISOString();
}

export function periodFromSubscription(sub: Stripe.Subscription): {
  start: string | null;
  end: string | null;
} {
  const item = sub.items?.data?.[0];
  const start =
    (item as { current_period_start?: number } | undefined)
      ?.current_period_start ??
    (sub as { current_period_start?: number }).current_period_start;
  const end =
    (item as { current_period_end?: number } | undefined)?.current_period_end ??
    (sub as { current_period_end?: number }).current_period_end;
  return { start: toIso(start), end: toIso(end) };
}

/** Lit le price id du 1er item (payload webhook parfois partiel). */
export function readSubscriptionPriceId(
  sub: Stripe.Subscription,
): string | null {
  const first = sub.items?.data?.[0];
  if (!first) return null;
  const price = first.price;
  if (typeof price === "string") return price;
  return price?.id ?? null;
}

/**
 * Mappe un abonnement Stripe → plan DocMind via price_id configurés.
 * Ancien price Premium 10 € (non listé dans les 4 nouveaux) → free.
 */
export function planFromSubscription(sub: Stripe.Subscription): BillingPlanId {
  const priceId = readSubscriptionPriceId(sub);
  const fromPrice = planIdFromStripePriceId(priceId);
  if (fromPrice !== "free") return fromPrice;

  // En prod (prices configurés) : le price Stripe est la seule source de vérité.
  // Évite un plan « Extra » local alors que Stripe est resté sur Pro (metadata seule).
  if (areStripePaidPricesConfigured()) {
    return "free";
  }

  const meta =
    sub.metadata?.docmind_plan?.trim() || sub.metadata?.plan?.trim() || "";
  const fromMeta = normalizeBillingPlanId(meta);
  if (isPaidBillingPlanId(fromMeta)) return fromMeta;
  return "free";
}

export function isStripePaidStatus(status: string): boolean {
  return (
    status === "active" || status === "trialing" || status === "past_due"
  );
}

/** @deprecated Prefer isStripePaidStatus */
export function isStripePremiumStatus(status: string): boolean {
  return isStripePaidStatus(status);
}

/**
 * Stripe peut annuler via `cancel_at_period_end` OU via `cancel_at` (timestamp),
 * notamment depuis le Customer Portal — les deux doivent être traités.
 */
export function isCancelScheduled(sub: Stripe.Subscription): boolean {
  if (sub.cancel_at_period_end) return true;
  if (!isStripePaidStatus(sub.status)) return false;
  return typeof sub.cancel_at === "number" && sub.cancel_at > 0;
}

/**
 * Applique l’état d’un abonnement Stripe dans la base locale (source de vérité).
 * L’ordre des événements est garanti sous le mutex `billing:sub:{userId}`.
 */
export async function applyStripeSubscription(
  userId: string,
  sub: Stripe.Subscription,
  eventMeta?: {
    id: string;
    type: string;
    created: number;
  },
): Promise<void> {
  const previous = await getUserSubscription(userId).catch(() => null);

  const period = periodFromSubscription(sub);
  const status = sub.status as BillingSubscriptionStatus;
  const catalogPlan = planFromSubscription(sub);
  const active = isStripePaidStatus(status);
  let nextPlan: BillingPlanId =
    active && isPaidBillingPlanId(catalogPlan) ? catalogPlan : "free";
  if (status === "canceled" || status === "unpaid") {
    nextPlan = "free";
  }
  const cancelScheduled = isCancelScheduled(sub);
  const periodEnd =
    period.end ||
    (typeof sub.cancel_at === "number" ? toIso(sub.cancel_at) : null);

  const applied = await upsertSubscriptionPatch(
    userId,
    {
      plan: nextPlan,
      status,
      stripeCustomerId:
        typeof sub.customer === "string"
          ? sub.customer
          : sub.customer?.id || null,
      stripeSubscriptionId: sub.id,
      stripePriceId: readSubscriptionPriceId(sub),
      currentPeriodStart: period.start,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: cancelScheduled,
      canceledAt: cancelScheduled
        ? toIso(sub.canceled_at) || new Date().toISOString()
        : status === "canceled"
          ? toIso(sub.canceled_at) || new Date().toISOString()
          : null,
      ...(eventMeta
        ? {
            lastWebhookEventId: eventMeta.id,
            lastWebhookEventType: eventMeta.type,
            lastWebhookAt: new Date(eventMeta.created * 1000).toISOString(),
          }
        : {
            lastWebhookEventType: "sync.stripe",
            lastWebhookAt: new Date().toISOString(),
          }),
    },
    eventMeta ? { webhookCreatedSec: eventMeta.created } : undefined,
  );

  if (!applied) return;

  const previousEffective = previous
    ? resolveEffectivePlan(previous.plan, previous.status, {
        currentPeriodEnd: previous.currentPeriodEnd,
      })
    : "free";
  const nextEffective = resolveEffectivePlan(nextPlan, status, {
    currentPeriodEnd: periodEnd,
  });
  if (isPlanTierUpgrade(previousEffective, nextEffective)) {
    await resetQuotasOnPlanUpgrade(userId);
  }

  const wasPaid =
    previous != null &&
    isPaidBillingPlanId(previous.plan) &&
    isStripePaidStatus(previous.status);
  const isPaidNow = isPaidBillingPlanId(nextPlan) && active;
  if (!wasPaid && isPaidNow) {
    await trackAnalyticsEvent({
      name: "billing.converted",
      userId,
      idempotencyKey: `billing.converted:${sub.id}:${period.start ?? "na"}`,
      meta: {
        plan: nextPlan,
        status,
        stripeSubscriptionId: sub.id,
        source: eventMeta?.type ?? "apply_subscription",
      },
    });
  } else if (wasPaid && !isPaidNow) {
    await trackAnalyticsEvent({
      name: "billing.churned",
      userId,
      idempotencyKey: eventMeta?.id
        ? `billing.churned:${eventMeta.id}`
        : `billing.churned:${sub.id}:${status}`,
      meta: {
        plan: "free",
        status,
        stripeSubscriptionId: sub.id,
        source: eventMeta?.type ?? "apply_subscription",
      },
    });
  }
}
