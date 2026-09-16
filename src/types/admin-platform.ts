import type { AdminOverviewAlert } from "@/types/admin-ops";

export type AdminLlmRuntime = {
  provider: "ollama" | "groq" | "mistral" | "openai_compatible";
  model: string;
  baseUrl: string;
  cloudEnabled: boolean;
};

export type AdminPlatformOverview = {
  at: string;
  llm: AdminLlmRuntime;
  tokens: {
    /** Somme metrics.totalTokens ≥100, jour calendaire UTC. 0 si rien de mesuré. */
    usedToday: number;
    /** Somme metrics.totalTokens ≥100, 30 j glissants. */
    usedMonth: number;
    jobsMeasuredToday: number;
    jobsUnmeasuredToday: number;
    jobsMeasuredMonth: number;
    jobsUnmeasuredMonth: number;
    /** null si aucun job mesuré sur 30 j. */
    avgPerAnalysis: number | null;
    /**
     * null si pas assez de mesure pour estimer.
     * Sinon floor((limit - usedToday) / avg) avec avg mesuré.
     */
    estimatedAnalysesRemainingToday: number | null;
    source: "metrics" | "none";
    limitPerDay: number;
    /** Origine du plafond affiché (jamais une réponse API Groq). */
    limitSource: "configured_groq_free" | "none";
    resetsAt: string;
    resetTimezone: "UTC";
  };
  users: {
    /** Comptes Auth Supabase si dispo, sinon union usage+subs+history. */
    totalEver: number;
    totalEverSource: "auth" | "app_union";
    /** Users avec ≥1 update app_history dans la fenêtre. */
    active24h: number;
    active7d: number;
    active30d: number;
    withAnalyses: number;
    /** active|trialing payants (hors past_due). */
    premiumActive: number;
    /** completed all-time / withAnalyses. */
    avgAnalysesPerUser: number;
  };
  analyses: {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    processing: number;
    /** Jobs créés durant le jour calendaire UTC. */
    todayUtc: number;
    avgDurationSec: number;
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
    lastDrainProcessed: number | null;
  };
  alerts: AdminOverviewAlert[];
};
