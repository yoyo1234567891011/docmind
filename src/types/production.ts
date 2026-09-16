export interface HostMetricsSample {
  at: string;
  cpuPercent: number | null;
  ramUsedMb: number;
  ramTotalMb: number;
  ramPercent: number;
  gpuPercent: number | null;
  vramUsedMb: number | null;
  vramTotalMb: number | null;
  vramPercent: number | null;
  source: "nvidia-smi" | "host-only";
}

export interface ProductionDashboard {
  at: string;
  window: {
    analysisHours: number;
    businessDays: number;
  };
  throughput: {
    analysesPerMin: number;
    analyses1h: number;
    analyses24h: number;
  };
  reliability: {
    success: number;
    errors: number;
    successRate: number;
    serverErrors24h: number;
  };
  latency: {
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    avgMs: number;
  };
  queue: {
    avgWaitMs: number;
    activeGenerations: number;
    activeKey: string | null;
  };
  cache: {
    hits: number;
    totalWithSource: number;
    hitRate: number;
  };
  host: HostMetricsSample;
  ollama: {
    up: boolean;
    model: string | null;
    /** Proxy VRAM Ollama /api/ps (pas nvidia-smi). */
    gpuProxyPercent: number | null;
  };
  stripe: {
    configured: boolean;
    webhookConfigured: boolean;
    status: "ok" | "partial" | "missing";
    label: string;
  };
  users: {
    /** Users avec ≥1 update app_history (même déf. Overview) ; sinon analytics éphémère. */
    active24h: number;
    active7d: number;
    activeSource: "app_history" | "analytics_ephemeral" | "none";
    signups30d: number | null;
    signupsSource: "analytics_ephemeral" | "none";
    premiumActive: number;
    premiumCanceling: number;
  };
  revenue: {
    mrrEur: number | null;
    estimatedRevenue30dEur: number | null;
    arpuEur: number | null;
    priceMonthlyEur: number;
    billingSource: string;
    /** Masqué en Stripe test — pas de MRR inventé. */
    revenueVisible: boolean;
  };
  funnel: {
    conversionRate: number;
    churnRate: number;
    checkoutStarted: number;
    converted: number;
    churned: number;
    cancelRequested: number;
    renewed: number;
  };
  alertsOpen: number;
}
