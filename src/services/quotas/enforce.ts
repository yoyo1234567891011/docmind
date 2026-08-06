import { getPlanQuotas, type QuotaMetric } from "@/config/quotas";
import { AppError } from "@/lib/errors";
import { entitlementsFailOpen } from "@/services/billing/entitlements";
import { hasPremiumAccess } from "@/services/billing/access";
import { getUserSubscription } from "@/services/billing/store";
import {
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
    throw new AppError(
      "FORBIDDEN",
      `Quota ${metric} mensuel atteint (${item.used}/${item.limit}). ${
        status.plan === "free"
          ? "Passez à Premium ou attendez le mois prochain."
          : "Contactez le support si besoin d’un plafond plus élevé."
      }`,
      403,
    );
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
    throw new AppError(
      "FORBIDDEN",
      `Quota ${metric} mensuel atteint (${item.used}/${item.limit}).`,
      403,
    );
  }
}
