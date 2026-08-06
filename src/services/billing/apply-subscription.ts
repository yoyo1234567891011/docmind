import type Stripe from "stripe";

import { getStripePremiumPriceId } from "@/config/billing";
import { trackAnalyticsEvent } from "@/services/analytics";
import {
  getUserSubscription,
  upsertSubscriptionPatch,
} from "@/services/billing/store";
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

/**
 * Mappe un abonnement Stripe → plan DocMind.
 * Accepte uniquement le price Premium configuré ou metadata explicite
 * (évite d’accorder Premium sur un autre produit Stripe du même customer).
 */
export function planFromSubscription(sub: Stripe.Subscription): BillingPlanId {
  const priceId = sub.items.data[0]?.price?.id;
  const premiumPrice = getStripePremiumPriceId();
  // En production le price id est la source de vérité.
  if (premiumPrice) {
    return priceId === premiumPrice ? "premium" : "free";
  }
  // Dev sans price configuré : metadata explicite uniquement.
  if (
    sub.metadata?.plan === "premium" ||
    sub.metadata?.docmind_plan === "premium"
  ) {
    return "premium";
  }
  return "free";
}

export function isStripePremiumStatus(status: string): boolean {
  return (
    status === "active" || status === "trialing" || status === "past_due"
  );
}

/**
 * Stripe peut annuler via `cancel_at_period_end` OU via `cancel_at` (timestamp),
 * notamment depuis le Customer Portal — les deux doivent être traités.
 */
export function isCancelScheduled(sub: Stripe.Subscription): boolean {
  if (sub.cancel_at_period_end) return true;
  if (!isStripePremiumStatus(sub.status)) return false;
  return typeof sub.cancel_at === "number" && sub.cancel_at > 0;
}

/**
 * Applique l’état d’un abonnement Stripe dans la base locale (source de vérité).
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

  // Rejette les webhooks hors-ordre (event.created plus ancien que le dernier appliqué).
  if (eventMeta && previous?.lastWebhookAt) {
    const prevMs = Date.parse(previous.lastWebhookAt);
    const eventMs = eventMeta.created * 1000;
    if (!Number.isNaN(prevMs) && eventMs < prevMs) {
      return;
    }
  }

  const period = periodFromSubscription(sub);
  const status = sub.status as BillingSubscriptionStatus;
  const catalogPlan = planFromSubscription(sub);
  const active = isStripePremiumStatus(status);
  const nextPlan: BillingPlanId =
    active && catalogPlan === "premium" ? "premium" : "free";
  const cancelScheduled = isCancelScheduled(sub);
  const periodEnd =
    period.end ||
    (typeof sub.cancel_at === "number" ? toIso(sub.cancel_at) : null);

  await upsertSubscriptionPatch(userId, {
    plan: nextPlan,
    status,
    stripeCustomerId:
      typeof sub.customer === "string" ? sub.customer : sub.customer?.id || null,
    stripeSubscriptionId: sub.id,
    stripePriceId: sub.items.data[0]?.price?.id || null,
    currentPeriodStart: period.start,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: cancelScheduled,
    // Ne garder canceledAt que si annulation planifiée ou effective —
    // sinon un resume laisserait un stale canceled_at Stripe et un faux badge.
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
  });

  if (status === "canceled" || status === "unpaid") {
    await upsertSubscriptionPatch(userId, {
      plan: "free",
      status,
    });
  }

  const wasPremium =
    previous != null &&
    previous.plan === "premium" &&
    isStripePremiumStatus(previous.status);
  const isPremiumNow = nextPlan === "premium" && active;
  if (!wasPremium && isPremiumNow) {
    await trackAnalyticsEvent({
      name: "billing.converted",
      userId,
      idempotencyKey: `billing.converted:${sub.id}:${period.start ?? "na"}`,
      meta: {
        plan: "premium",
        status,
        stripeSubscriptionId: sub.id,
        source: eventMeta?.type ?? "apply_subscription",
      },
    });
  } else if (wasPremium && !isPremiumNow) {
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
