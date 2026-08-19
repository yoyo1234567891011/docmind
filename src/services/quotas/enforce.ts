import { getPlanQuotas, type QuotaMetric } from "@/config/quotas";
import { AppError } from "@/lib/errors";
import { entitlementsFailOpen } from "@/services/billing/entitlements";
import { hasPremiumAccess } from "@/services/billing/access";
import { getUserSubscription } from "@/services/billing/store";
import {
  decrementUserUsage,
  getUserUsage,
  incrementUserUsage,
  type UserUsageMonth,
} from "@/services/quotas/store";
import type { BillingPlanId } from "@/types/billing";

export interface QuotaStatusItem {
  metric: QuotaMetric;
  used: number;
  limit: number;
  remaining: number;
  unlimited: boolean;
}

export interface QuotaStatus {
  plan: BillingPlanId;
  month: string;
  items: QuotaStatusItem[];
}

function resolvePlan(
  userId: string,
  subscriptionPlan: BillingPlanId,
  status: string,
  currentPeriodEnd?: string | null,
): BillingPlanId {
  if (entitlementsFailOpen()) return "premium";
  return hasPremiumAccess(subscriptionPlan, status, { currentPeriodEnd })
    ? "premium"
    : "free";
}

export function pickQuotaItem(
  status: QuotaStatus,
  metric: QuotaMetric,
): QuotaStatusItem | undefined {
  return status.items.find((i) => i.metric === metric);
}

/** Message utilisateur quand le plafond mensuel est atteint. */
export function quotaExceededMessage(
  status: QuotaStatus,
  metric: QuotaMetric,
): string {
  const item = pickQuotaItem(status, metric);
  if (!item) return "Quota mensuel atteint.";

  if (metric === "analyze") {
    if (status.plan === "free") {
      return `Vous avez utilisé vos ${item.limit} analyses du mois. Passez Premium pour continuer.`;
    }
    return `Quota Premium atteint pour ce mois (${item.limit} analyses). Réessayez le mois prochain.`;
  }

  return status.plan === "free"
    ? `Quota mensuel atteint (${item.used}/${item.limit}). Passez Premium ou attendez le mois prochain.`
    : `Quota mensuel atteint (${item.used}/${item.limit}). Réessayez le mois prochain.`;
}

function quotaExceededError(
  status: QuotaStatus,
  metric: QuotaMetric,
): AppError {
  return new AppError(
    "QUOTA_EXCEEDED",
    quotaExceededMessage(status, metric),
    403,
  );
}

export async function getQuotaStatus(userId: string): Promise<QuotaStatus> {
  const sub = await getUserSubscription(userId);
  const plan = resolvePlan(userId, sub.plan, sub.status, sub.currentPeriodEnd);
  const limits = getPlanQuotas(plan);
  const usage = await getUserUsage(userId);
  const metrics: QuotaMetric[] = ["analyze", "upload", "letter", "search"];

  return {
    plan,
    month: usage.month,
    items: metrics.map((metric) => {
      const limit = limits[metric];
      const used = usage[metric] ?? 0;
      const unlimited = limit < 0;
      return {
        metric,
        used,
        limit,
        remaining: unlimited ? Number.POSITIVE_INFINITY : Math.max(0, limit - used),
        unlimited,
      };
    }),
  };
}

/**
 * Vérifie + consomme 1 unité de quota (atomique en PG / lock FS).
 * Lève FORBIDDEN (403) si dépassé.
 */
export async function consumeQuota(
  userId: string,
  metric: QuotaMetric,
): Promise<UserUsageMonth> {
  const status = await getQuotaStatus(userId);
  const item = status.items.find((i) => i.metric === metric);
  if (!item) {
    throw new AppError("INTERNAL_ERROR", "Quota inconnu.", 500);
  }
  const limit = item.unlimited ? -1 : item.limit;
  const next = await incrementUserUsage(userId, metric, 1, limit);
  if (!next) {
    throw quotaExceededError(status, metric);
  }
  return next;
}

/** Vérifie sans consommer (préflight). */
export async function assertQuotaAvailable(
  userId: string,
  metric: QuotaMetric,
): Promise<void> {
  const status = await getQuotaStatus(userId);
  const item = status.items.find((i) => i.metric === metric);
  if (!item) return;
  if (!item.unlimited && item.used >= item.limit) {
    throw quotaExceededError(status, metric);
  }
}

/** Rembourse 1 unité après échec d’opération (best-effort). */
export async function refundQuota(
  userId: string,
  metric: QuotaMetric,
): Promise<void> {
  await decrementUserUsage(userId, metric, 1);
}
