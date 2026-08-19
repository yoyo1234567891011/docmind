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
    usedToday: number;
    usedMonth: number;
    limitPerDay: number;
    avgPerAnalysis: number;
    estimatedAnalysesRemainingToday: number;
    source: "metrics" | "estimate";
  };
  users: {
    totalEver: number;
    active24h: number;
    active7d: number;
    active30d: number;
    withAnalyses: number;
    premiumActive: number;
    avgAnalysesPerUser: number;
  };
  analyses: {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    processing: number;
    today: number;
    avgDurationSec: number;
  };
  jobs: {
    queuePending: number;
    queueProcessing: number;
    reclaimedStale: number;
  };
  health: {
    ok: boolean;
    cronConfigured: boolean;
    storageMode: "persistent" | "filesystem";
  };
};
