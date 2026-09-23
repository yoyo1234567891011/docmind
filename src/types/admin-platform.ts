import type { AdminOverviewAlert } from "@/types/admin-ops";
import type { BillingPlanId } from "@/types/billing";

export type AdminLlmRuntime = {
  provider: "ollama" | "groq" | "mistral" | "openai_compatible";
  /** Modèle effectif runtime (après remap Groq si applicable). */
  model: string;
  /** Valeur brute LLM_MODEL (si différente du runtime). */
  modelEnv?: string | null;
  baseUrl: string;
  cloudEnabled: boolean;
};

export type AdminNdNumber = {
  value: number | null;
  reason?: string;
};

export type AdminPlatformOverview = {
  at: string;
  timezone: "Europe/Paris";
  llm: AdminLlmRuntime;
  tokens: {
    usedTodayParis: number;
    usedMonthRolling30d: number;
    jobsMeasuredToday: number;
    jobsUnmeasuredToday: number;
    jobsMeasuredMonth: number;
    jobsUnmeasuredMonth: number;
    avgPerAnalysis: number | null;
    /** Estimation locale vs plafond configuré — pas l’API Groq. */
    estimatedAnalysesRemainingToday: number | null;
    source: "metrics" | "none";
    limitPerDay: number;
    limitSource: "configured_estimate" | "none";
    limitLabel: string;
    resetsAt: string;
    resetTimezone: "UTC";
  };
  presence: {
    onlineNow: AdminNdNumber;
    connectedTodayParis: AdminNdNumber;
    signedUpTodayParis: AdminNdNumber;
    source: "auth+presence" | "unavailable";
  };
  users: {
    authAccounts: AdminNdNumber;
    withAnalysesAmongAuth: AdminNdNumber;
    orphanHistoryUsers: AdminNdNumber;
    /** Actifs analyse parmi comptes Auth encore présents. */
    activeAnalyze24h: number;
    activeAnalyze7d: number;
    activeAnalyze30d: number;
    avgAnalysesPerUserWithHistory: number | null;
  };
  billing: {
    stripeMode: "test" | "live" | "unconfigured";
    freeNeverSubscribed: number | null;
    byPlanActive: Array<{ plan: BillingPlanId; count: number }>;
    paidActive: number;
    pastDue: number;
    canceled: number;
    cancelAtPeriodEnd: number;
  };
  usage: {
    /** Completed avec usage LLM réel (totalTokens > 0) — jour Paris. */
    jobsCompletedTodayParis: number;
    /** Completed sans usage (= fallback local / generate_failed) — jour Paris. */
    jobsFallbackTodayParis: number;
    jobsFailedTodayParis: number;
    jobsPending: number;
    jobsProcessing: number;
    /** Completed LLM (tokens > 0) sur 7j / 30j. */
    jobsCompleted7d: number;
    jobsFailed7d: number;
    jobsCompleted30d: number;
    jobsFallback7d: number;
    /**
     * failed / (llm_ok + failed) 24h — les fallbacks locaux sont exclus
     * (ni succès Groq ni failed status).
     */
    failRate24h: number | null;
    uploadsTodayParis: number;
    freeQuotaHitTodayParis: number | null;
    freeQuotaHitMonth: number | null;
    freeAnalyzeLimit: number;
  };
  analyses: {
    total: number;
    completed: number;
    failed: number;
    todayParis: number;
    avgWallDurationSec7d: number | null;
    avgLlmDurationSec7d: number | null;
  };
  jobs: {
    queuePending: number;
    queueProcessing: number;
    reclaimedStale: number;
    stuck: number;
  };
  health: {
    ok: boolean;
    cronConfigured: boolean;
    storageMode: "persistent" | "filesystem";
    dbOk: boolean;
    lastDrainAt: string | null;
    lastDrainAgeSec: number | null;
    lastDrainProcessed: number | null;
  };
  alerts: AdminOverviewAlert[];
};
