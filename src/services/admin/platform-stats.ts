import { createClient } from "@supabase/supabase-js";

import { getLlmProviderConfig } from "@/ai/models/llm-provider";
import { getPlanQuotas } from "@/config/quotas";
import { usePersistentStorage } from "@/config/persistence";
import { getDatabaseUrl, query } from "@/lib/db/pool";
import { collectAdminBillingDetail } from "@/services/admin/billing-admin";
import { countStuckAnalysisJobs } from "@/services/admin/jobs-admin";
import { getDrainStatus } from "@/services/admin/ops-status";
import type { AdminOverviewAlert } from "@/types/admin-ops";
import type {
  AdminNdNumber,
  AdminPlatformOverview,
} from "@/types/admin-platform";
import type { BillingPlanId } from "@/types/billing";
import { BILLING_PLANS, isPaidBillingPlanId } from "@/config/billing";

/**
 * Seuil anti-faux métriques : ancien salvage totalTokens=1 —
 * exclu des sommes (un job P2 Groq réel est typiquement 2–5k+).
 */
const MIN_REAL_JOB_TOKENS = 100;

/** Plafond catalogue estimé (pas l’API quota live Groq). */
const CONFIGURED_DAILY_TOKEN_CEILING = 200_000;

const TZ = "Europe/Paris";

function nd(value: number | null, reason?: string): AdminNdNumber {
  return value == null ? { value: null, reason } : { value };
}

/** Début du jour calendaire Europe/Paris en timestamptz. */
function parisDayStartSql(alias = "timezone('utc', now())"): string {
  return `(date_trunc('day', timezone('${TZ}', ${alias})) AT TIME ZONE '${TZ}')`;
}

function detectProviderLabel(): AdminPlatformOverview["llm"]["provider"] {
  const cfg = getLlmProviderConfig();
  if (cfg.kind === "ollama") return "ollama";
  const url = cfg.baseUrl.toLowerCase();
  if (url.includes("groq.com")) return "groq";
  if (url.includes("mistral")) return "mistral";
  return "openai_compatible";
}

function nextUtcMidnight(now = new Date()): Date {
  return new Date(
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
}

/** Mois produit (UTC YYYY-MM) — aligné quotas user. */
function usageMonthUtc(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

type AuthUserMeta = {
  id: string;
  createdAt: string | null;
  lastSignInAt: string | null;
};

async function listAuthUsersMeta(): Promise<AuthUserMeta[] | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !service) return null;
  try {
    const admin = createClient(url, service, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const out: AuthUserMeta[] = [];
    let page = 1;
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error) return null;
      for (const u of data.users) {
        out.push({
          id: u.id,
          createdAt: u.created_at ?? null,
          lastSignInAt: u.last_sign_in_at ?? null,
        });
      }
      if (data.users.length < 200) break;
      page += 1;
      if (page > 50) break;
    }
    return out;
  } catch {
    return null;
  }
}

function isSameParisDay(iso: string | null, now = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return false;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d) === fmt.format(now);
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

  const freeLimit = getPlanQuotas("free").analyze;
  const monthKey = usageMonthUtc();

  const [
    authUsers,
    jobStats,
    todayTokens,
    monthTokens,
    billing,
    stuckCount,
    drain,
    presenceOnline,
    freeQuotaHits,
    uploadsToday,
  ] = await Promise.all([
    listAuthUsersMeta(),
    queryJobStats(),
    queryTokensUsed("paris_day"),
    queryTokensUsed("rolling_30d"),
    collectAdminBillingDetail().catch(() => null),
    countStuckAnalysisJobs().catch(() => 0),
    getDrainStatus().catch(() => ({
      lastSuccessAt: null,
      lastProcessed: null,
      lastError: null,
    })),
    queryPresenceOnline().catch(() => null),
    queryFreeQuotaHits(monthKey, freeLimit).catch(() => null),
    queryUploadsTodayParis().catch(() => 0),
  ]);

  const authIds = authUsers ? new Set(authUsers.map((u) => u.id)) : null;

  const userStats = await queryUserStats(authIds).catch(() => ({
    withAnalysesAmongAuth: 0,
    orphanHistoryUsers: 0,
    activeAnalyze24h: 0,
    activeAnalyze7d: 0,
    activeAnalyze30d: 0,
    completedAmongAuth: 0,
  }));

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
  const now = Date.now();
  const lastDrainAgeSec =
    drain.lastSuccessAt != null
      ? Math.max(
          0,
          Math.round((now - new Date(drain.lastSuccessAt).getTime()) / 1000),
        )
      : null;

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
  if (cronConfigured && lastDrainAgeSec != null && lastDrainAgeSec > 300) {
    alerts.push({
      id: "drain_stale",
      severity: "warning",
      code: "DRAIN_STALE",
      message: `Dernier drain il y a ${lastDrainAgeSec}s (>5 min).`,
    });
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

  const usedToday = todayTokens.fromMetrics;
  const usedMonth = monthTokens.fromMetrics;
  const jobsUnmeasuredToday = Math.max(
    0,
    todayTokens.jobsCompleted - todayTokens.jobsWithRealMetrics,
  );
  const jobsUnmeasuredMonth = Math.max(
    0,
    monthTokens.jobsCompleted - monthTokens.jobsWithRealMetrics,
  );
  const avgPerAnalysis =
    monthTokens.jobsWithRealMetrics > 0
      ? Math.round(monthTokens.fromMetrics / monthTokens.jobsWithRealMetrics)
      : null;

  const limitPerDay = cloudEnabled ? CONFIGURED_DAILY_TOKEN_CEILING : 0;
  const estimatedAnalysesRemainingToday =
    limitPerDay > 0 && avgPerAnalysis != null && avgPerAnalysis > 0
      ? Math.max(0, Math.floor((limitPerDay - usedToday) / avgPerAnalysis))
      : null;

  const signedUpTodayParis = authUsers
    ? authUsers.filter((u) => isSameParisDay(u.createdAt)).length
    : null;

  // Connectés aujourd’hui = union last_sign_in Auth ∪ presence last_seen (Paris).
  let connectedTodayParis: number | null = null;
  if (authUsers && authIds && authIds.size > 0) {
    const presenceTodayIds = await queryPresenceConnectedTodayParisIds([
      ...authIds,
    ]).catch(() => null);
    const connected = new Set<string>();
    for (const u of authUsers) {
      if (isSameParisDay(u.lastSignInAt)) connected.add(u.id);
    }
    if (presenceTodayIds) {
      for (const id of presenceTodayIds) connected.add(id);
    }
    connectedTodayParis = connected.size;
  } else if (authUsers) {
    connectedTodayParis = authUsers.filter((u) =>
      isSameParisDay(u.lastSignInAt),
    ).length;
  }

  const onlineNow =
    authIds && presenceOnline != null
      ? await queryPresenceOnlineAmong(authIds).catch(() => presenceOnline)
      : presenceOnline;

  const avgAnalysesPerUserWithHistory =
    userStats.withAnalysesAmongAuth > 0
      ? Math.round(
          (userStats.completedAmongAuth / userStats.withAnalysesAmongAuth) *
            10,
        ) / 10
      : userStats.withAnalysesAmongAuth === 0 && authIds
        ? 0
        : null;

  const failDenom24h =
    jobStats.completed24h + jobStats.failed24h;
  const failRate24h =
    failDenom24h > 0 ? Math.round((jobStats.failed24h / failDenom24h) * 1000) / 1000 : null;

  const stripeMode = billing?.stripeMode ?? "unconfigured";
  const byPlanActive: Array<{ plan: BillingPlanId; count: number }> = (
    Object.keys(BILLING_PLANS) as BillingPlanId[]
  ).map((plan) => ({
    plan,
    count:
      billing?.byPlan.find((p) => p.plan === plan)?.count ??
      0,
  }));

  // Free jamais souscrit = Auth − users avec sub payante active/trialing en DB
  let freeNeverSubscribed: number | null = null;
  if (authUsers && billing) {
    const paidUserIds = await listPaidActiveUserIds().catch(() => null);
    if (paidUserIds) {
      freeNeverSubscribed = authUsers.filter((u) => !paidUserIds.has(u.id))
        .length;
    }
  }

  const canceled = await countCanceledSubs().catch(() => 0);

  return {
    at: new Date().toISOString(),
    timezone: TZ,
    llm: {
      provider: detectProviderLabel(),
      model,
      baseUrl,
      cloudEnabled,
    },
    tokens: {
      usedTodayParis: usedToday,
      usedMonthRolling30d: usedMonth,
      jobsMeasuredToday: todayTokens.jobsWithRealMetrics,
      jobsUnmeasuredToday,
      jobsMeasuredMonth: monthTokens.jobsWithRealMetrics,
      jobsUnmeasuredMonth,
      avgPerAnalysis,
      estimatedAnalysesRemainingToday,
      source:
        todayTokens.jobsWithRealMetrics > 0 ||
        monthTokens.jobsWithRealMetrics > 0
          ? "metrics"
          : "none",
      limitPerDay,
      limitSource: cloudEnabled ? "configured_estimate" : "none",
      limitLabel: cloudEnabled
        ? `Estimation plafond configuré (${CONFIGURED_DAILY_TOKEN_CEILING.toLocaleString("fr-FR")} tok/jour) — pas le quota API Groq`
        : "Pas de plafond (mode local)",
      resetsAt: nextUtcMidnight().toISOString(),
      resetTimezone: "UTC",
    },
    presence: {
      onlineNow: nd(
        onlineNow,
        onlineNow == null
          ? "Presence indisponible (pas de blob / persistent)"
          : undefined,
      ),
      connectedTodayParis: nd(
        connectedTodayParis,
        connectedTodayParis == null
          ? "Auth listUsers indisponible"
          : undefined,
      ),
      signedUpTodayParis: nd(
        signedUpTodayParis,
        signedUpTodayParis == null
          ? "Auth listUsers indisponible"
          : undefined,
      ),
      source: authUsers ? "auth+presence" : "unavailable",
    },
    users: {
      authAccounts: nd(
        authUsers?.length ?? null,
        authUsers == null ? "SUPABASE_SERVICE_ROLE_KEY / listUsers KO" : undefined,
      ),
      withAnalysesAmongAuth: nd(
        authIds ? userStats.withAnalysesAmongAuth : null,
        authIds == null ? "Auth indisponible — compteur non comparable" : undefined,
      ),
      orphanHistoryUsers: nd(
        authIds ? userStats.orphanHistoryUsers : null,
        authIds == null ? "Auth indisponible" : undefined,
      ),
      activeAnalyze24h: userStats.activeAnalyze24h,
      activeAnalyze7d: userStats.activeAnalyze7d,
      activeAnalyze30d: userStats.activeAnalyze30d,
      avgAnalysesPerUserWithHistory,
    },
    billing: {
      stripeMode,
      freeNeverSubscribed,
      byPlanActive,
      paidActive: billing?.paidActiveEffective ?? 0,
      pastDue: billing?.pastDue ?? 0,
      canceled,
      cancelAtPeriodEnd: billing?.cancelAtPeriodEnd ?? 0,
    },
    usage: {
      jobsCompletedTodayParis: jobStats.completedTodayParis,
      jobsFailedTodayParis: jobStats.failedTodayParis,
      jobsPending: jobStats.pending,
      jobsProcessing: jobStats.processing,
      jobsCompleted7d: jobStats.completed7d,
      jobsFailed7d: jobStats.failed7d,
      jobsCompleted30d: jobStats.completed30d,
      failRate24h,
      uploadsTodayParis: uploadsToday,
      freeQuotaHitTodayParis: freeQuotaHits?.today ?? null,
      freeQuotaHitMonth: freeQuotaHits?.month ?? null,
      freeAnalyzeLimit: freeLimit,
    },
    analyses: {
      total: jobStats.total,
      completed: jobStats.completed,
      failed: jobStats.failed,
      todayParis: jobStats.createdTodayParis,
      avgWallDurationSec7d:
        jobStats.avgWallDurationSec7d > 0
          ? jobStats.avgWallDurationSec7d
          : null,
      avgLlmDurationSec7d:
        jobStats.avgLlmDurationSec7d > 0
          ? jobStats.avgLlmDurationSec7d
          : null,
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
      lastDrainAgeSec,
      lastDrainProcessed: drain.lastProcessed,
    },
    alerts,
  };
}

async function listPaidActiveUserIds(): Promise<Set<string>> {
  const { rows } = await query<{ user_id: string; data: { plan?: string; status?: string } }>(
    `select user_id, data from public.app_subscriptions`,
  );
  const set = new Set<string>();
  for (const row of rows) {
    const plan = row.data?.plan;
    const status = row.data?.status;
    if (
      typeof plan === "string" &&
      isPaidBillingPlanId(plan) &&
      (status === "active" || status === "trialing")
    ) {
      set.add(row.user_id);
    }
  }
  return set;
}

async function countCanceledSubs(): Promise<number> {
  const { rows } = await query<{ n: string }>(
    `select count(*)::text as n from public.app_subscriptions
     where data->>'status' = 'canceled'`,
  );
  return Number(rows[0]?.n ?? 0);
}

async function queryPresenceOnline(): Promise<number | null> {
  if (!usePersistentStorage()) return null;
  try {
    const { rows } = await query<{ n: string }>(
      `select count(*)::text as n
       from public.app_user_blobs
       where key = 'presence'
         and coalesce((data->>'lastSeenAt')::timestamptz, to_timestamp(0))
             >= timezone('utc', now()) - interval '5 minutes'`,
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return null;
  }
}

async function queryPresenceOnlineAmong(
  authIds: Set<string>,
): Promise<number | null> {
  if (!usePersistentStorage() || authIds.size === 0) return null;
  const ids = [...authIds];
  const { rows } = await query<{ n: string }>(
    `select count(*)::text as n
     from public.app_user_blobs
     where key = 'presence'
       and user_id = any($1::text[])
       and coalesce((data->>'lastSeenAt')::timestamptz, to_timestamp(0))
           >= timezone('utc', now()) - interval '5 minutes'`,
    [ids],
  );
  return Number(rows[0]?.n ?? 0);
}

async function queryPresenceConnectedTodayParisIds(
  authIds: string[],
): Promise<string[] | null> {
  if (!usePersistentStorage() || authIds.length === 0) return null;
  const { rows } = await query<{ user_id: string }>(
    `select user_id
     from public.app_user_blobs
     where key = 'presence'
       and user_id = any($1::text[])
       and coalesce((data->>'lastSeenAt')::timestamptz, to_timestamp(0))
           >= ${parisDayStartSql()}`,
    [authIds],
  );
  return rows.map((r) => r.user_id);
}

async function queryUserStats(authIds: Set<string> | null): Promise<{
  withAnalysesAmongAuth: number;
  orphanHistoryUsers: number;
  activeAnalyze24h: number;
  activeAnalyze7d: number;
  activeAnalyze30d: number;
  completedAmongAuth: number;
}> {
  if (!authIds) {
    // Sans Auth : on ne ment pas avec des totaux history globaux comme « Auth ».
    return {
      withAnalysesAmongAuth: 0,
      orphanHistoryUsers: 0,
      activeAnalyze24h: 0,
      activeAnalyze7d: 0,
      activeAnalyze30d: 0,
      completedAmongAuth: 0,
    };
  }
  const ids = [...authIds];
  const { rows } = await query<{
    with_analyses: string;
    orphans: string;
    active_24h: string;
    active_7d: string;
    active_30d: string;
  }>(
    `
    with history_users as (
      select distinct user_id from public.app_history
    ),
    history_activity as (
      select user_id, max(updated_at) as last_active
      from public.app_history
      where user_id = any($1::text[])
      group by user_id
    )
    select
      (select count(*) from history_users where user_id = any($1::text[]))::text as with_analyses,
      (select count(*) from history_users where not (user_id = any($1::text[])))::text as orphans,
      (select count(*) from history_activity
        where last_active >= timezone('utc', now()) - interval '24 hours')::text as active_24h,
      (select count(*) from history_activity
        where last_active >= timezone('utc', now()) - interval '7 days')::text as active_7d,
      (select count(*) from history_activity
        where last_active >= timezone('utc', now()) - interval '30 days')::text as active_30d
    `,
    [ids],
  );
  const r = rows[0];

  const { rows: jobRows } = await query<{ n: string }>(
    `select count(*)::text as n from public.app_analysis_jobs
     where status = 'completed' and user_id = any($1::text[])`,
    [ids],
  );

  return {
    withAnalysesAmongAuth: Number(r?.with_analyses ?? 0),
    orphanHistoryUsers: Number(r?.orphans ?? 0),
    activeAnalyze24h: Number(r?.active_24h ?? 0),
    activeAnalyze7d: Number(r?.active_7d ?? 0),
    activeAnalyze30d: Number(r?.active_30d ?? 0),
    completedAmongAuth: Number(jobRows[0]?.n ?? 0),
  };
}

async function queryJobStats(): Promise<{
  total: number;
  completed: number;
  failed: number;
  pending: number;
  processing: number;
  createdTodayParis: number;
  completedTodayParis: number;
  failedTodayParis: number;
  completed24h: number;
  failed24h: number;
  completed7d: number;
  failed7d: number;
  completed30d: number;
  avgWallDurationSec7d: number;
  avgLlmDurationSec7d: number;
  reclaimedStale: number;
}> {
  const dayStart = parisDayStartSql();
  const { rows } = await query<{
    total: string;
    completed: string;
    failed: string;
    pending: string;
    processing: string;
    created_today: string;
    completed_today: string;
    failed_today: string;
    completed_24h: string;
    failed_24h: string;
    completed_7d: string;
    failed_7d: string;
    completed_30d: string;
    avg_wall: string;
    avg_llm: string;
    reclaimed_stale: string;
  }>(`
    select
      count(*)::text as total,
      count(*) filter (where status = 'completed')::text as completed,
      count(*) filter (where status = 'failed')::text as failed,
      count(*) filter (where status = 'pending')::text as pending,
      count(*) filter (where status = 'processing')::text as processing,
      count(*) filter (where created_at >= ${dayStart})::text as created_today,
      count(*) filter (
        where status = 'completed' and coalesce(completed_at, created_at) >= ${dayStart}
      )::text as completed_today,
      count(*) filter (
        where status = 'failed' and created_at >= ${dayStart}
      )::text as failed_today,
      count(*) filter (
        where status = 'completed'
          and created_at >= timezone('utc', now()) - interval '24 hours'
      )::text as completed_24h,
      count(*) filter (
        where status = 'failed'
          and created_at >= timezone('utc', now()) - interval '24 hours'
      )::text as failed_24h,
      count(*) filter (
        where status = 'completed'
          and created_at >= timezone('utc', now()) - interval '7 days'
      )::text as completed_7d,
      count(*) filter (
        where status = 'failed'
          and created_at >= timezone('utc', now()) - interval '7 days'
      )::text as failed_7d,
      count(*) filter (
        where status = 'completed'
          and created_at >= timezone('utc', now()) - interval '30 days'
      )::text as completed_30d,
      coalesce(round(avg(
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
      ))::int, 0)::text as avg_wall,
      coalesce(round(avg(
        case
          when metrics ? 'generateMs'
            and (metrics->>'generateMs')::numeric between 50 and 600000
          then (metrics->>'generateMs')::numeric / 1000.0
          else null
        end
      ) filter (
        where status = 'completed'
          and created_at >= timezone('utc', now()) - interval '7 days'
      ))::int, 0)::text as avg_llm,
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
    createdTodayParis: Number(r?.created_today ?? 0),
    completedTodayParis: Number(r?.completed_today ?? 0),
    failedTodayParis: Number(r?.failed_today ?? 0),
    completed24h: Number(r?.completed_24h ?? 0),
    failed24h: Number(r?.failed_24h ?? 0),
    completed7d: Number(r?.completed_7d ?? 0),
    failed7d: Number(r?.failed_7d ?? 0),
    completed30d: Number(r?.completed_30d ?? 0),
    avgWallDurationSec7d: Number(r?.avg_wall ?? 0),
    avgLlmDurationSec7d: Number(r?.avg_llm ?? 0),
    reclaimedStale: Number(r?.reclaimed_stale ?? 0),
  };
}

async function queryTokensUsed(
  window: "paris_day" | "rolling_30d",
): Promise<{
  fromMetrics: number;
  jobsWithRealMetrics: number;
  jobsCompleted: number;
}> {
  const windowSql =
    window === "paris_day"
      ? `created_at >= ${parisDayStartSql()}`
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

async function queryUploadsTodayParis(): Promise<number> {
  const { rows } = await query<{ n: string }>(
    `select count(*)::text as n from public.app_documents
     where created_at >= ${parisDayStartSql()}`,
  );
  return Number(rows[0]?.n ?? 0);
}

async function queryFreeQuotaHits(
  monthKey: string,
  freeLimit: number,
): Promise<{ today: number; month: number } | null> {
  if (freeLimit < 0) return { today: 0, month: 0 };
  try {
    const dayStart = parisDayStartSql();
    const { rows } = await query<{ today: string; month: string }>(
      `
      select
        (
          select count(*)::text
          from public.app_usage u
          where u.month = $1
            and coalesce((u.data->>'analyze')::int, 0) >= $2
            and u.updated_at >= ${dayStart}
            and not exists (
              select 1 from public.app_subscriptions s
              where s.user_id = u.user_id
                and s.data->>'status' in ('active', 'trialing')
                and s.data->>'plan' in ('basique','pro','premium','extra')
            )
        ) as today,
        (
          select count(*)::text
          from public.app_usage u
          where u.month = $1
            and coalesce((u.data->>'analyze')::int, 0) >= $2
            and not exists (
              select 1 from public.app_subscriptions s
              where s.user_id = u.user_id
                and s.data->>'status' in ('active', 'trialing')
                and s.data->>'plan' in ('basique','pro','premium','extra')
            )
        ) as month
      `,
      [monthKey, freeLimit],
    );
    return {
      today: Number(rows[0]?.today ?? 0),
      month: Number(rows[0]?.month ?? 0),
    };
  } catch {
    return null;
  }
}
