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

/** letter = 0 sur Free ; miroir analyze sur plans payants (affichage). */
const DEFAULTS: Record<BillingPlanId, PlanQuotaLimits> = {
  free: { analyze: 5, upload: 10, letter: 0, search: 5 },
  basique: { analyze: 15, upload: 30, letter: 15, search: 40 },
  pro: { analyze: 40, upload: 80, letter: 40, search: 120 },
  premium: { analyze: 75, upload: 150, letter: 75, search: 250 },
  extra: { analyze: 150, upload: 300, letter: 150, search: 500 },
};

const ENV_PREFIX: Record<BillingPlanId, string> = {
  free: "QUOTA_FREE",
  basique: "QUOTA_BASIQUE",
  pro: "QUOTA_PRO",
  premium: "QUOTA_PREMIUM",
  extra: "QUOTA_EXTRA",
};

export function getPlanQuotas(plan: BillingPlanId): PlanQuotaLimits {
  const prefix = ENV_PREFIX[plan] ?? ENV_PREFIX.free;
  const base = DEFAULTS[plan] ?? DEFAULTS.free;
  const analyze = envInt(`${prefix}_ANALYZE`, base.analyze);
  const letterEnv = process.env[`${prefix}_LETTER`]?.trim();
  const letter =
    plan === "free"
      ? 0
      : letterEnv && Number.isFinite(Number(letterEnv))
        ? Math.trunc(Number(letterEnv))
        : analyze;
  return {
    analyze,
    upload: envInt(`${prefix}_UPLOAD`, base.upload),
    letter,
    search: envInt(`${prefix}_SEARCH`, base.search),
  };
}

export const QUOTA_METRIC_LABELS: Record<QuotaMetric, string> = {
  analyze: "Analyses",
  upload: "Uploads PDF",
  letter: "Courriers IA",
  search: "Recherches",
};
