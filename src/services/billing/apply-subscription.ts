import type Stripe from "stripe";

import {
  hasAnyStripePaidPriceConfigured,
  isPaidBillingPlanId,
  normalizeBillingPlanId,
  planIdFromStripePriceId,
  planTierRank,
} from "@/config/billing";
import { isDeployedEnv } from "@/lib/env-validate";
import { trackAnalyticsEvent } from "@/services/analytics";
import {
  getUserSubscription,
  upsertSubscriptionPatch,
} from "@/services/billing/store";
import type {
  BillingPlanId,
  BillingSubscriptionStatus,
  PaidBillingPlanId,
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
 *
 * Fail-closed : en déployé, ou dès qu’un STRIPE_PRICE_* est présent,
 * jamais de trust metadata plan (évite Extra local via metadata seule).
 * Fallback metadata uniquement en local sans aucun price configuré (tests).
 */
export function planFromSubscription(sub: Stripe.Subscription): BillingPlanId {
  const priceId = readSubscriptionPriceId(sub);
  const fromPrice = planIdFromStripePriceId(priceId);
  if (fromPrice !== "free") return fromPrice;

  if (isDeployedEnv() || hasAnyStripePaidPriceConfigured()) {
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
 * Downgrade programmé : metadata Stripe + schedule.
 * Tant que le price courant ≠ pending, on expose pendingPlan pour l’UI.
 */
export function resolvePendingDowngrade(
  sub: Stripe.Subscription,
  currentPlan: BillingPlanId,
  periodEnd: string | null,
): {
  pendingPlan: PaidBillingPlanId | null;
  pendingPlanEffectiveAt: string | null;
} {
  const raw =
    sub.metadata?.docmind_pending_plan?.trim() ||
    sub.metadata?.pending_plan?.trim() ||
    "";
  const pending = normalizeBillingPlanId(raw);
  if (!isPaidBillingPlanId(pending)) {
    return { pendingPlan: null, pendingPlanEffectiveAt: null };
  }
  // Déjà basculé sur le plan bas (phase schedule terminée).
  if (currentPlan === pending) {
    return { pendingPlan: null, pendingPlanEffectiveAt: null };
  }
  // Pending n’a de sens que si inférieur au plan actuel.
  if (planTierRank(pending) >= planTierRank(currentPlan)) {
    return { pendingPlan: null, pendingPlanEffectiveAt: null };
  }
  const atRaw = sub.metadata?.docmind_pending_plan_at?.trim() || "";
  let effectiveAt: string | null = periodEnd;
  if (atRaw) {
    const asNum = Number(atRaw);
    if (Number.isFinite(asNum) && asNum > 1_000_000_000) {
      effectiveAt = toIso(asNum);
    } else if (!Number.isNaN(Date.parse(atRaw))) {
      effectiveAt = new Date(atRaw).toISOString();
    }
  }
  return { pendingPlan: pending, pendingPlanEffectiveAt: effectiveAt };
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

  const pending = resolvePendingDowngrade(sub, nextPlan, periodEnd);

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
      pendingPlan: pending.pendingPlan,
      pendingPlanEffectiveAt: pending.pendingPlanEffectiveAt,
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

  // Upgrade / downgrade : jamais de reset `used` — seules les limit du plan changent.

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
