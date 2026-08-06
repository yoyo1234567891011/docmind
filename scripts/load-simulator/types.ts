/** Types du test de charge DocMind */

export type LoadMode = "live" | "model" | "hybrid";

export type AuthMode = "eval" | "supabase" | "none";

export interface SimulatorOptions {
  baseUrl: string;
  usersLevels: number[];
  mode: LoadMode;
  auth: AuthMode;
  /** Analyses par utilisateur virtuel */
  docsPerUser: number;
  /** Timeout P2 polling (ms) */
  p2TimeoutMs: number;
  /** Intervalle poll historique (ms) */
  pollIntervalMs: number;
  /** Force live même pour N≥100 */
  forceLive: boolean;
  /** Utilisateurs max en live dans hybrid (calibration) */
  calibrateUsers: number;
  evalApiKey?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  pdfPath?: string;
  outDir: string;
}

export interface SystemSample {
  at: string;
  cpuPercent: number | null;
  ramUsedMb: number | null;
  ramTotalMb: number | null;
  gpuPercent: number | null;
  gpuMemUsedMb: number | null;
  gpuMemTotalMb: number | null;
}

export interface InfraProbeSample {
  at: string;
  redisMs: number | null;
  redisOk: boolean | null;
  postgresMs: number | null;
  postgresOk: boolean | null;
  s3Ms: number | null;
  s3Ok: boolean | null;
}

export interface LatencyPercentiles {
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface InfraProbeSummary {
  configured: boolean;
  samples: number;
  okRate: number;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  note?: string;
}

export interface UserStepResult {
  step: "signup" | "upload" | "analyze_p1" | "analyze_p2" | "history";
  ok: boolean;
  durationMs: number;
  error?: string;
  timeout?: boolean;
  queueWaitMs?: number;
  meta?: Record<string, string | number | boolean | null>;
}

export interface VirtualUserResult {
  userIndex: number;
  userId: string;
  steps: UserStepResult[];
  ok: boolean;
  totalMs: number;
}

export interface LevelMetrics {
  concurrentUsers: number;
  mode: LoadMode | "live-calibrate" | "model-projected";
  wallMs: number;
  usersCompleted: number;
  usersFailed: number;
  failureRate: number;
  timeoutCount: number;
  timeoutRate: number;
  /** Temps d'attente moyen avant démarrage P2 effectif (file) */
  avgQueueWaitMs: number;
  maxQueueWaitMs: number;
  p50QueueWaitMs: number;
  p95QueueWaitMs: number;
  p99QueueWaitMs: number;
  /** Longueur moyenne / max de la file (analyses P2 en attente + en cours) */
  avgQueueLength: number;
  maxQueueLength: number;
  avgP1Ms: number;
  p50P1Ms: number;
  p95P1Ms: number;
  p99P1Ms: number;
  avgP2Ms: number;
  p50P2Ms: number;
  p95P2Ms: number;
  p99P2Ms: number;
  avgUploadMs: number;
  p50UploadMs: number;
  p95UploadMs: number;
  p99UploadMs: number;
  avgHistoryMs: number;
  avgTotalUserMs: number;
  p50TotalMs: number;
  p95TotalMs: number;
  p99TotalMs: number;
  saturation: {
    saturated: boolean;
    reason: string;
    /** Utilisation théorique serveur GPU (ρ) 0..1+ */
    rho: number;
  };
  system: {
    avgCpuPercent: number | null;
    maxCpuPercent: number | null;
    avgRamPercent: number | null;
    maxRamPercent: number | null;
    avgGpuPercent: number | null;
    maxGpuPercent: number | null;
  };
  infra: {
    redis: InfraProbeSummary;
    postgres: InfraProbeSummary;
    s3: InfraProbeSummary;
  };
  cache: {
    hits: number;
    total: number;
    hitRate: number;
    note?: string;
  };
  notes: string[];
}

export interface LoadSimulationReport {
  generatedAt: string;
  options: SimulatorOptions;
  calibration?: {
    serviceTimeP2Ms: number;
    serviceTimeP1Ms: number;
    throughputPerHour: number;
  };
  levels: LevelMetrics[];
  conclusion: string;
}
