import type { BillingPlanId } from "@/types/billing";

/** Unité de quota métier (indépendant du rate-limit HTTP). */
export type QuotaMetric =
  | "analyze"
  | "upload"
  | "letter"
  | "search";

export interface PlanQuotaLimits {
  analyze: number;
  upload: number;
  letter: number;
  search: number;
}

/**
 * Quotas mensuels configurables (env override possible).
 * -1 = illimité
 */
function envInt(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function getPlanQuotas(plan: BillingPlanId): PlanQuotaLimits {
  if (plan === "premium") {
    return {
      analyze: envInt("QUOTA_PREMIUM_ANALYZE", 200),
      upload: envInt("QUOTA_PREMIUM_UPLOAD", 500),
      letter: envInt("QUOTA_PREMIUM_LETTER", 100),
      search: envInt("QUOTA_PREMIUM_SEARCH", 2_000),
    };
  }
  return {
    analyze: envInt("QUOTA_FREE_ANALYZE", 20),
    upload: envInt("QUOTA_FREE_UPLOAD", 40),
    letter: envInt("QUOTA_FREE_LETTER", 0),
    search: envInt("QUOTA_FREE_SEARCH", 200),
  };
}

export const QUOTA_METRIC_LABELS: Record<QuotaMetric, string> = {
  analyze: "Analyses",
  upload: "Uploads PDF",
  letter: "Courriers IA",
  search: "Recherches",
};
