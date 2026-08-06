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
    active24h: number;
    active7d: number;
    signups30d: number;
    premiumActive: number;
    premiumCanceling: number;
  };
  revenue: {
    mrrEur: number;
    estimatedRevenue30dEur: number;
    arpuEur: number;
    priceMonthlyEur: number;
    billingSource: string;
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
