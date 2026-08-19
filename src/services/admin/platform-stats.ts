import { getLlmProviderConfig } from "@/ai/models/llm-provider";
import { usePersistentStorage } from "@/config/persistence";
import { query } from "@/lib/db/pool";
import { collectBillingAdminRollup } from "@/services/billing/admin-metrics";
import type { AdminPlatformOverview } from "@/types/admin-platform";

/** Tokens moyens par analyse P2 (mesuré sur gpt-oss-120b). */
const ESTIMATED_TOKENS_PER_ANALYSIS = 4_000;

/** Quotas Groq free tier — openai/gpt-oss-120b. */
const GROQ_FREE_DAILY_TOKENS = 200_000;

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
  ] = await Promise.all([
    queryUserStats(),
    queryJobStats(),
    queryTokensUsed("day"),
    queryTokensUsed("month"),
    collectBillingAdminRollup().catch(() => ({
      premiumActive: 0,
      premiumCanceling: 0,
      mrrEur: 0,
      priceMonthlyEur: 0,
      source: "unavailable",
    })),
  ]);

  const usedToday =
    todayTokens.fromMetrics > 0
      ? todayTokens.fromMetrics
      : jobStats.completedToday * ESTIMATED_TOKENS_PER_ANALYSIS;
  const usedMonth =
    monthTokens.fromMetrics > 0
      ? monthTokens.fromMetrics
      : jobStats.completed * ESTIMATED_TOKENS_PER_ANALYSIS;

  const avgPerAnalysis =
    jobStats.completedWithMetrics > 0
      ? Math.round(monthTokens.fromMetrics / jobStats.completedWithMetrics)
      : ESTIMATED_TOKENS_PER_ANALYSIS;

  const limitPerDay = cloudEnabled ? groqDailyTokenLimit(model) : 0;
  const remaining =
    limitPerDay > 0
      ? Math.max(0, Math.floor((limitPerDay - usedToday) / Math.max(avgPerAnalysis, 1)))
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
    },
    health: {
      ok: true,
      cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
      storageMode: usePersistentStorage() ? "persistent" : "filesystem",
    },
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
          and metrics ? 'totalTokens')::text as completed_with_metrics,
        coalesce(
          round(avg(
            extract(epoch from (updated_at - created_at))
          ) filter (where status = 'completed'))::int,
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
      completedWithMetrics: 0,
      avgDurationSec: 0,
      reclaimedStale: 0,
    };
  }
}

async function queryTokensUsed(
  window: "day" | "month",
): Promise<{ fromMetrics: number }> {
  const interval = window === "day" ? "24 hours" : "30 days";
  try {
    const { rows } = await query<{ total: string }>(
      `
      select coalesce(
        sum((metrics->>'totalTokens')::bigint),
        0
      )::text as total
      from public.app_analysis_jobs
      where status = 'completed'
        and created_at >= timezone('utc', now()) - interval '${interval}'
        and metrics ? 'totalTokens'
      `,
    );
    return { fromMetrics: Number(rows[0]?.total ?? 0) };
  } catch {
    return { fromMetrics: 0 };
  }
}
