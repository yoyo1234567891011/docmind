import { estimateAnalysisCostEur } from "@/config/analytics";
import type {
  AnalyticsEvent,
  AnalyticsProductSummary,
  AnalyticsTimingSummary,
} from "@/types/analytics";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function timingSummary(values: number[]): AnalyticsTimingSummary {
  if (values.length === 0) {
    return { count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const avg = Math.round(
    sorted.reduce((sum, n) => sum + n, 0) / sorted.length,
  );
  return {
    count: sorted.length,
    avgMs: avg,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
  };
}

function num(meta: AnalyticsEvent["meta"], key: string): number | null {
  const value = meta?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(meta: AnalyticsEvent["meta"], key: string): string | null {
  const value = meta?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function summarizeProductAnalytics(
  events: AnalyticsEvent[],
  options?: { windowDays?: number },
): AnalyticsProductSummary {
  const windowDays = options?.windowDays ?? 30;
  const since =
    Date.now() - Math.max(1, windowDays) * 24 * 60 * 60 * 1000;
  const windowed = events.filter((e) => {
    const t = Date.parse(e.at);
    return Number.isFinite(t) && t >= since;
  });

  const byName = (name: AnalyticsEvent["name"]) =>
    windowed.filter((e) => e.name === name);

  const started = byName("analysis.started");
  const completed = byName("analysis.completed");
  const errored = byName("analysis.error");
  const fallbacks = byName("analysis.fallback");
  const abandons = byName("analysis.abandon");
  const p1 = byName("analysis.p1");
  const p2 = byName("analysis.p2");
  const extractions = byName("extraction.completed");
  const satisfaction = byName("satisfaction.rated");
  const checkout = byName("billing.checkout_started");
  const converted = byName("billing.converted");
  const renewed = byName("billing.renewed");
  const cancelRequested = byName("billing.cancel_requested");
  const refunded = byName("billing.refunded");
  const churned = byName("billing.churned");
  const pageViews = byName("page.view");
  const signups = byName("auth.signup");
  const logins = byName("auth.login");
  const accountDeleted = byName("account.deleted");
  const accountExported = byName("account.exported");

  const p1Ms = p1
    .map((e) => num(e.meta, "durationMs"))
    .filter((n): n is number => n !== null);
  const p2Ms = p2
    .map((e) => num(e.meta, "durationMs"))
    .filter((n): n is number => n !== null);
  const totalMs = completed
    .map((e) => num(e.meta, "durationMs"))
    .filter((n): n is number => n !== null);
  const extractMs = extractions
    .map((e) => num(e.meta, "durationMs"))
    .filter((n): n is number => n !== null);
  const ocrMs = extractions
    .map((e) => num(e.meta, "ocrDurationMs"))
    .filter((n): n is number => n !== null);

  const ratings = satisfaction
    .map((e) => num(e.meta, "rating"))
    .filter((n): n is number => n !== null && n >= 1 && n <= 5);
  const distribution: Record<string, number> = {
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
  };
  for (const r of ratings) {
    distribution[String(Math.round(r))] =
      (distribution[String(Math.round(r))] ?? 0) + 1;
  }

  const typeCounts = new Map<string, number>();
  for (const event of [...completed, ...p2, ...started]) {
    const label =
      str(event.meta, "documentType") ||
      str(event.meta, "categoryLabel") ||
      str(event.meta, "category");
    if (!label) continue;
    typeCounts.set(label, (typeCounts.get(label) ?? 0) + 1);
  }
  const topDocumentTypes = [...typeCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  let totalCost = 0;
  let costCount = 0;
  for (const event of [...completed, ...p2]) {
    const durationMs = num(event.meta, "durationMs");
    const totalTokens = num(event.meta, "totalTokens");
    const explicit = num(event.meta, "estimatedCostEur");
    if (explicit !== null) {
      totalCost += explicit;
      costCount += 1;
      continue;
    }
    if (durationMs === null && totalTokens === null) continue;
    totalCost += estimateAnalysisCostEur({ durationMs, totalTokens });
    costCount += 1;
  }

  const denomStarted = Math.max(started.length, 1);
  const recentErrors = errored.slice(0, 20).map((e) => ({
    at: e.at,
    message: str(e.meta, "message") || e.name,
    code: str(e.meta, "errorCode") || undefined,
    phase: str(e.meta, "phase") || undefined,
  }));

  return {
    windowDays,
    totalEvents: windowed.length,
    analysesStarted: started.length,
    analysesCompleted: completed.length,
    analysesErrored: errored.length,
    fallbackCount: fallbacks.length,
    fallbackRate:
      completed.length + fallbacks.length === 0
        ? 0
        : fallbacks.length / Math.max(completed.length + fallbacks.length, 1),
    abandonCount: abandons.length,
    abandonRate: abandons.length / denomStarted,
    p1: timingSummary(p1Ms),
    p2: timingSummary(p2Ms),
    analysisTotal: timingSummary(totalMs),
    extraction: timingSummary(extractMs),
    ocr: timingSummary(ocrMs),
    satisfaction: {
      ratings: ratings.length,
      average:
        ratings.length === 0
          ? null
          : Math.round(
              (ratings.reduce((s, n) => s + n, 0) / ratings.length) * 10,
            ) / 10,
      distribution,
    },
    topDocumentTypes,
    pageViews: pageViews.length,
    signups: signups.length,
    logins: logins.length,
    conversion: {
      checkoutStarted: checkout.length,
      converted: converted.length,
      renewed: renewed.length,
      cancelRequested: cancelRequested.length,
      refunded: refunded.length,
      churned: churned.length,
      freeToPremiumRate:
        checkout.length === 0 ? 0 : converted.length / checkout.length,
    },
    account: {
      deleted: accountDeleted.length,
      exported: accountExported.length,
    },
    cost: {
      avgPerAnalysisEur:
        costCount === 0
          ? 0
          : Math.round((totalCost / costCount) * 10_000) / 10_000,
      totalEstimatedEur: Math.round(totalCost * 10_000) / 10_000,
      analysesWithCost: costCount,
    },
    recentErrors,
  };
}
