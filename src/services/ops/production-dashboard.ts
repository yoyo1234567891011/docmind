import { getOllamaGenerateLockState } from "@/ai/models/generate-lock";
import { readAnalyticsFile } from "@/services/analytics/store";
import { summarizeProductAnalytics } from "@/services/analytics/summarize";
import { collectBillingAdminRollup } from "@/services/billing/admin-metrics";
import { buildMonitoringSnapshot } from "@/services/monitoring/collect";
import { listMonitoringEvents } from "@/services/monitoring/store";
import { sampleHostMetrics } from "@/services/ops/host-metrics";
import {
  getStripeWebhookSecret,
  isStripeConfigured,
} from "@/lib/stripe/env";
import type { ProductionDashboard } from "@/types/production";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx] ?? 0;
}

function distinctUsers(
  events: Array<{ at: string; userId?: string | null }>,
  sinceMs: number,
): number {
  const cutoff = Date.now() - sinceMs;
  const ids = new Set<string>();
  for (const e of events) {
    const t = Date.parse(e.at);
    if (!Number.isFinite(t) || t < cutoff) continue;
    if (e.userId) ids.add(e.userId);
  }
  return ids.size;
}

/**
 * Agrège monitoring + analytics + hôte + billing pour le dashboard production.
 */
export async function buildProductionDashboard(): Promise<ProductionDashboard> {
  const analysisWindowMs = 24 * 60 * 60 * 1000;
  const businessDays = 30;

  const [events24h, events1h, snapshot, host, analyticsFile, billing] =
    await Promise.all([
      listMonitoringEvents(analysisWindowMs),
      listMonitoringEvents(60 * 60 * 1000),
      buildMonitoringSnapshot(analysisWindowMs),
      sampleHostMetrics(),
      readAnalyticsFile(),
      collectBillingAdminRollup(),
    ]);

  const analyticsEvents = analyticsFile.events;
  const product = summarizeProductAnalytics(analyticsEvents, {
    windowDays: businessDays,
  });

  const ok24 = events24h.filter((e) => e.name === "analysis.ok");
  const err24 = events24h.filter((e) => e.name === "analysis.error");
  const analyses1h = events1h.filter(
    (e) => e.name === "analysis.ok" || e.name === "analysis.error",
  ).length;

  const durations = ok24
    .map((e) => Number(e.meta?.durationMs ?? 0))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  const waits = events24h
    .filter((e) => e.name === "queue.wait")
    .map((e) => Number(e.meta?.waitMs ?? 0))
    .filter((n) => Number.isFinite(n) && n >= 0);

  let cacheHits = 0;
  let cacheTotal = 0;
  for (const e of [...ok24, ...err24]) {
    const src = e.meta?.resultSource;
    if (typeof src !== "string" || !src) continue;
    cacheTotal += 1;
    if (src === "cache") cacheHits += 1;
  }
  // Fallback analytics p2 meta
  if (cacheTotal === 0) {
    for (const e of analyticsEvents) {
      if (e.name !== "analysis.p2" && e.name !== "analysis.completed") continue;
      const src = e.meta?.resultSource;
      if (typeof src !== "string" || !src) continue;
      cacheTotal += 1;
      if (src === "cache") cacheHits += 1;
    }
  }

  const analysesPerMin =
    analyses1h > 0
      ? Math.round((analyses1h / 60) * 100) / 100
      : Math.round((ok24.length + err24.length) / (24 * 60) * 100) / 100;

  const lock = getOllamaGenerateLockState();
  const stripeConfigured = isStripeConfigured();
  const webhookConfigured = Boolean(getStripeWebhookSecret());
  const stripeStatus: ProductionDashboard["stripe"]["status"] =
    stripeConfigured && webhookConfigured
      ? "ok"
      : stripeConfigured || webhookConfigured
        ? "partial"
        : "missing";

  const activeBase =
    billing.premiumActive + product.conversion.churned;
  const churnRate =
    activeBase === 0
      ? 0
      : product.conversion.churned / Math.max(activeBase, 1);

  const estimatedRevenue30dEur =
    Math.round(
      (product.conversion.converted * billing.priceMonthlyEur +
        product.conversion.renewed * billing.priceMonthlyEur) *
        100,
    ) / 100;

  const arpuEur =
    billing.premiumActive === 0
      ? 0
      : Math.round((billing.mrrEur / billing.premiumActive) * 100) / 100;

  return {
    at: new Date().toISOString(),
    window: {
      analysisHours: 24,
      businessDays,
    },
    throughput: {
      analysesPerMin,
      analyses1h,
      analyses24h: ok24.length + err24.length,
    },
    reliability: {
      success: ok24.length,
      errors: err24.length,
      successRate:
        ok24.length + err24.length === 0
          ? 1
          : ok24.length / (ok24.length + err24.length),
      serverErrors24h: snapshot.serverErrors24h,
    },
    latency: {
      p50Ms: Math.round(percentile(durations, 50)),
      p95Ms: Math.round(percentile(durations, 95)),
      p99Ms: Math.round(percentile(durations, 99)),
      avgMs:
        durations.length === 0
          ? 0
          : Math.round(
              durations.reduce((a, b) => a + b, 0) / durations.length,
            ),
    },
    queue: {
      avgWaitMs:
        waits.length === 0
          ? 0
          : Math.round(waits.reduce((a, b) => a + b, 0) / waits.length),
      activeGenerations: lock.activeCount,
      activeKey: lock.activeKey,
    },
    cache: {
      hits: cacheHits,
      totalWithSource: cacheTotal,
      hitRate: cacheTotal === 0 ? 0 : cacheHits / cacheTotal,
    },
    host,
    ollama: {
      up: snapshot.workers.ollamaUp,
      model: snapshot.gpu.model ?? null,
      gpuProxyPercent: snapshot.gpu.utilizationPercent,
    },
    stripe: {
      configured: stripeConfigured,
      webhookConfigured,
      status: stripeStatus,
      label:
        stripeStatus === "ok"
          ? "Stripe prêt"
          : stripeStatus === "partial"
            ? "Config partielle"
            : "Non configuré",
    },
    users: {
      active24h: distinctUsers(analyticsEvents, 24 * 60 * 60 * 1000),
      active7d: distinctUsers(analyticsEvents, 7 * 24 * 60 * 60 * 1000),
      signups30d: product.signups,
      premiumActive: billing.premiumActive,
      premiumCanceling: billing.premiumCanceling,
    },
    revenue: {
      mrrEur: billing.mrrEur,
      estimatedRevenue30dEur,
      arpuEur,
      priceMonthlyEur: billing.priceMonthlyEur,
      billingSource: billing.source,
    },
    funnel: {
      conversionRate: product.conversion.freeToPremiumRate,
      churnRate,
      checkoutStarted: product.conversion.checkoutStarted,
      converted: product.conversion.converted,
      churned: product.conversion.churned,
      cancelRequested: product.conversion.cancelRequested,
      renewed: product.conversion.renewed,
    },
    alertsOpen: snapshot.alertsOpen,
  };
}
