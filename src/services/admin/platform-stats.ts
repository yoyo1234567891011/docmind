import { getLlmProviderConfig } from "@/ai/models/llm-provider";
import { usePersistentStorage } from "@/config/persistence";
import { getDatabaseUrl, query } from "@/lib/db/pool";
import { collectBillingAdminRollup } from "@/services/billing/admin-metrics";
import { countStuckAnalysisJobs } from "@/services/admin/jobs-admin";
import { getDrainStatus } from "@/services/admin/ops-status";
import type { AdminOverviewAlert } from "@/types/admin-ops";
import type { AdminPlatformOverview } from "@/types/admin-platform";

/** Tokens moyens par analyse P2 (mesuré sur gpt-oss-120b). */
const ESTIMATED_TOKENS_PER_ANALYSIS = 4_000;

/**
 * Seuil anti-faux métriques : certains chemins salvage écrivent totalTokens=1
 * pour passer la validation publish — à exclure des sommes admin.
 */
const MIN_REAL_JOB_TOKENS = 100;

/** Plafond catalogue Groq free TPD (gpt-oss-*) — pas l’API quota live. */
const GROQ_FREE_DAILY_TOKENS = 200_000;

/** Groq TPD (tokens/jour) se réinitialise à minuit UTC. */
function nextGroqDailyTokenResetAt(now = new Date()): Date {
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    ),
  );
  return next;
}

function detectProviderLabel(): AdminPlatformOverview["llm"]["provider"] {
  const cfg = getLlmProviderConfig();
  if (cfg.kind === "ollama") return "ollama";
  const url = cfg.baseUrl.toLowerCase();
  if (url.includes("groq.com")) return "groq";
  if (url.includes("mistral")) return "mistral";
  return "openai_compatible";
}

function groqDailyTokenLimit(model: string): number {
  if (/gpt-oss-120b/i.test(model)) return GROQ_FREE_DAILY_TOKENS;
  if (/gpt-oss-20b/i.test(model)) return GROQ_FREE_DAILY_TOKENS;
  return GROQ_FREE_DAILY_TOKENS;
}

export async function buildAdminPlatformOverview(): Promise<AdminPlatformOverview> {
  const llmCfg = getLlmProviderConfig();
  const cloudEnabled = llmCfg.kind === "openai_compatible";
  const model =
    cloudEnabled ? llmCfg.model : process.env.OLLAMA_MODEL?.trim() || "mistral";
  const baseUrl =
    cloudEnabled
      ? llmCfg.baseUrl
      : process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";

  const [
    userStats,
    jobStats,
    todayTokens,
    monthTokens,
    billing,
    stuckCount,
    drain,
  ] = await Promise.all([
    queryUserStats(),
    queryJobStats(),
    queryTokensUsed("utc_day"),
    queryTokensUsed("rolling_30d"),
    collectBillingAdminRollup().catch(() => ({
      premiumActive: 0,
      premiumCanceling: 0,
      mrrEur: 0,
      priceMonthlyEur: 0,
      source: "unavailable" as const,
    })),
    countStuckAnalysisJobs().catch(() => 0),
    getDrainStatus().catch(() => ({
      lastSuccessAt: null,
      lastProcessed: null,
      lastError: null,
    })),
  ]);

  let dbOk = true;
  if (usePersistentStorage() || getDatabaseUrl()) {
    try {
      await query(`select 1 as ok`);
    } catch {
      dbOk = false;
    }
  }

  const cronConfigured = Boolean(process.env.CRON_SECRET?.trim());
  const healthOk = dbOk && stuckCount < 20;

  const alerts: AdminOverviewAlert[] = [];
  if (!dbOk) {
    alerts.push({
      id: "db_down",
      severity: "critical",
      code: "DB_DEGRADED",
      message: "Base de données injoignable (select 1 a échoué).",
    });
  }
  if (!cronConfigured) {
    alerts.push({
      id: "cron_missing",
      severity: "critical",
      code: "CRON_NOT_CONFIGURED",
      message: "CRON_SECRET absent — drain P2 non sécurisé / non déclenchable.",
    });
  }
  if (stuckCount > 0) {
    alerts.push({
      id: "jobs_stuck",
      severity: stuckCount >= 5 ? "critical" : "warning",
      code: "JOBS_STUCK",
      message: `${stuckCount} job(s) stuck > 10 min (pending/processing).`,
    });
  }
  // Taux d’échec sur 7j seulement (les failed historiques ne doivent pas alerter).
  const recentDenom = jobStats.completed7d + jobStats.failed7d;
  if (jobStats.failed7d > 0 && recentDenom > 0) {
    const failRate = jobStats.failed7d / recentDenom;
    if (failRate > 0.2) {
      alerts.push({
        id: "fail_rate",
        severity: "warning",
        code: "HIGH_FAIL_RATE",
        message: `Taux d’échecs jobs 7j élevé (${jobStats.failed7d} failed / ${recentDenom}).`,
      });
    }
  }
  if (cronConfigured && !drain.lastSuccessAt) {
    alerts.push({
      id: "drain_never",
      severity: "info",
      code: "DRAIN_NO_SUCCESS_LOG",
      message:
        "Cron configuré mais aucun succès drain encore journalisé (attendre un tick).",
    });
  }

  const avgPerAnalysis =
    monthTokens.jobsWithRealMetrics > 0
      ? Math.round(monthTokens.fromMetrics / monthTokens.jobsWithRealMetrics)
      : ESTIMATED_TOKENS_PER_ANALYSIS;

  // Jour UTC (= fenêtre Groq TPD). totalTokens < MIN exclus (souvent placeholders =1).
  const usedToday =
    todayTokens.fromMetrics > 0
      ? todayTokens.fromMetrics
      : todayTokens.jobsCompleted * avgPerAnalysis;
  const usedMonth =
    monthTokens.fromMetrics > 0
      ? monthTokens.fromMetrics
      : monthTokens.jobsCompleted * avgPerAnalysis;

  const limitPerDay = cloudEnabled ? groqDailyTokenLimit(model) : 0;
  const remaining =
    limitPerDay > 0
      ? Math.max(
          0,
          Math.floor((limitPerDay - usedToday) / Math.max(avgPerAnalysis, 1)),
        )
      : 0;

  const avgAnalysesPerUser =
    userStats.withAnalyses === 0
      ? 0
      : Math.round((jobStats.completed / userStats.withAnalyses) * 10) / 10;

  return {
    at: new Date().toISOString(),
    llm: {
      provider: detectProviderLabel(),
      model,
      baseUrl,
      cloudEnabled,
    },
    tokens: {
      usedToday,
      usedMonth,
      limitPerDay,
      avgPerAnalysis,
      estimatedAnalysesRemainingToday: remaining,
      source: todayTokens.fromMetrics > 0 ? "metrics" : "estimate",
      resetsAt: nextGroqDailyTokenResetAt().toISOString(),
      resetTimezone: "UTC",
    },
    users: {
      totalEver: userStats.totalEver,
      active24h: userStats.active24h,
      active7d: userStats.active7d,
      active30d: userStats.active30d,
      withAnalyses: userStats.withAnalyses,
      premiumActive: billing.premiumActive,
      avgAnalysesPerUser: avgAnalysesPerUser,
    },
    analyses: {
      total: jobStats.total,
      completed: jobStats.completed,
      failed: jobStats.failed,
      pending: jobStats.pending,
      processing: jobStats.processing,
      today: jobStats.today,
      avgDurationSec: jobStats.avgDurationSec,
    },
    jobs: {
      queuePending: jobStats.pending,
      queueProcessing: jobStats.processing,
      reclaimedStale: jobStats.reclaimedStale,
      stuck: stuckCount,
    },
    health: {
      ok: healthOk,
      cronConfigured,
      storageMode: usePersistentStorage() ? "persistent" : "filesystem",
      dbOk,
      lastDrainAt: drain.lastSuccessAt,
      lastDrainProcessed: drain.lastProcessed,
    },
    alerts,
  };
}

async function queryUserStats(): Promise<{
  totalEver: number;
  active24h: number;
  active7d: number;
  active30d: number;
  withAnalyses: number;
}> {
  try {
    const { rows } = await query<{
      total_ever: string;
      active_24h: string;
      active_7d: string;
      active_30d: string;
      with_analyses: string;
    }>(`
      with all_users as (
        select user_id from public.app_usage
        union
        select user_id from public.app_subscriptions
        union
        select user_id from public.app_history
      ),
      history_activity as (
        select
          user_id,
          max(updated_at) as last_active
        from public.app_history
        group by user_id
      )
      select
        (select count(distinct user_id) from all_users)::text as total_ever,
        (select count(*) from history_activity
          where last_active >= timezone('utc', now()) - interval '24 hours')::text as active_24h,
        (select count(*) from history_activity
          where last_active >= timezone('utc', now()) - interval '7 days')::text as active_7d,
        (select count(*) from history_activity
          where last_active >= timezone('utc', now()) - interval '30 days')::text as active_30d,
        (select count(distinct user_id) from public.app_history)::text as with_analyses
    `);
    const r = rows[0];
    return {
      totalEver: Number(r?.total_ever ?? 0),
      active24h: Number(r?.active_24h ?? 0),
      active7d: Number(r?.active_7d ?? 0),
      active30d: Number(r?.active_30d ?? 0),
      withAnalyses: Number(r?.with_analyses ?? 0),
    };
  } catch {
    return {
      totalEver: 0,
      active24h: 0,
      active7d: 0,
      active30d: 0,
      withAnalyses: 0,
    };
  }
}

async function queryJobStats(): Promise<{
  total: number;
  completed: number;
  failed: number;
  pending: number;
  processing: number;
  today: number;
  completedToday: number;
  completed7d: number;
  failed7d: number;
  completedWithMetrics: number;
  avgDurationSec: number;
  reclaimedStale: number;
}> {
  try {
    const { rows } = await query<{
      total: string;
      completed: string;
      failed: string;
      pending: string;
      processing: string;
      today: string;
      completed_today: string;
      completed_7d: string;
      failed_7d: string;
      completed_with_metrics: string;
      avg_duration_sec: string;
      reclaimed_stale: string;
    }>(`
      select
        count(*)::text as total,
        count(*) filter (where status = 'completed')::text as completed,
        count(*) filter (where status = 'failed')::text as failed,
        count(*) filter (where status = 'pending')::text as pending,
        count(*) filter (where status = 'processing')::text as processing,
        count(*) filter (where created_at >= timezone('utc', now()) - interval '24 hours')::text as today,
        count(*) filter (where status = 'completed'
          and created_at >= timezone('utc', now()) - interval '24 hours')::text as completed_today,
        count(*) filter (where status = 'completed'
          and created_at >= timezone('utc', now()) - interval '7 days')::text as completed_7d,
        count(*) filter (where status = 'failed'
          and created_at >= timezone('utc', now()) - interval '7 days')::text as failed_7d,
        count(*) filter (where status = 'completed'
          and metrics ? 'totalTokens')::text as completed_with_metrics,
        -- Durée P2 réelle : metrics.totalMs (ms→s), fenêtre 7j, hors outliers >10 min.
        -- Ancien calcul wall-clock all-time (updated_at-created_at) gonflait à des heures.
        coalesce(
          round(avg(
            case
              when metrics ? 'totalMs'
                and (metrics->>'totalMs')::numeric between 1000 and 600000
              then (metrics->>'totalMs')::numeric / 1000.0
              when started_at is not null and completed_at is not null
                and extract(epoch from (completed_at - started_at)) between 1 and 600
              then extract(epoch from (completed_at - started_at))
              else null
            end
          ) filter (
            where status = 'completed'
              and created_at >= timezone('utc', now()) - interval '7 days'
          ))::int,
          0
        )::text as avg_duration_sec,
        count(*) filter (where last_error = 'reclaimed_stale_lease')::text as reclaimed_stale
      from public.app_analysis_jobs
    `);
    const r = rows[0];
    return {
      total: Number(r?.total ?? 0),
      completed: Number(r?.completed ?? 0),
      failed: Number(r?.failed ?? 0),
      pending: Number(r?.pending ?? 0),
      processing: Number(r?.processing ?? 0),
      today: Number(r?.today ?? 0),
      completedToday: Number(r?.completed_today ?? 0),
      completed7d: Number(r?.completed_7d ?? 0),
      failed7d: Number(r?.failed_7d ?? 0),
      completedWithMetrics: Number(r?.completed_with_metrics ?? 0),
      avgDurationSec: Number(r?.avg_duration_sec ?? 0),
      reclaimedStale: Number(r?.reclaimed_stale ?? 0),
    };
  } catch {
    return {
      total: 0,
      completed: 0,
      failed: 0,
      pending: 0,
      processing: 0,
      today: 0,
      completedToday: 0,
      completed7d: 0,
      failed7d: 0,
      completedWithMetrics: 0,
      avgDurationSec: 0,
      reclaimedStale: 0,
    };
  }
}

async function queryTokensUsed(
  window: "utc_day" | "rolling_30d",
): Promise<{
  fromMetrics: number;
  jobsWithRealMetrics: number;
  jobsCompleted: number;
}> {
  const windowSql =
    window === "utc_day"
      ? `created_at >= date_trunc('day', timezone('utc', now()))`
      : `created_at >= timezone('utc', now()) - interval '30 days'`;
  try {
    const { rows } = await query<{
      tokens: string;
      with_metrics: string;
      completed: string;
    }>(
      `
      select
        coalesce(
          sum((metrics->>'totalTokens')::bigint) filter (
            where status = 'completed'
              and ${windowSql}
              and metrics ? 'totalTokens'
              and (metrics->>'totalTokens')::bigint >= ${MIN_REAL_JOB_TOKENS}
          ),
          0
        )::text as tokens,
        count(*) filter (
          where status = 'completed'
            and ${windowSql}
            and metrics ? 'totalTokens'
            and (metrics->>'totalTokens')::bigint >= ${MIN_REAL_JOB_TOKENS}
        )::text as with_metrics,
        count(*) filter (
          where status = 'completed' and ${windowSql}
        )::text as completed
      from public.app_analysis_jobs
      `,
    );
    return {
      fromMetrics: Number(rows[0]?.tokens ?? 0),
      jobsWithRealMetrics: Number(rows[0]?.with_metrics ?? 0),
      jobsCompleted: Number(rows[0]?.completed ?? 0),
    };
  } catch {
    return { fromMetrics: 0, jobsWithRealMetrics: 0, jobsCompleted: 0 };
  }
}
