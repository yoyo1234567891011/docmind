/** Types — file d'analyse durable (Architecture A). */

export const ANALYSIS_JOB_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
] as const;

export type AnalysisJobStatus = (typeof ANALYSIS_JOB_STATUSES)[number];

/** Timings mesurés côté worker (ms) — pas d’ETA. */
export type AnalysisJobMetrics = {
  queueWaitMs: number;
  lockWaitMs: number;
  generateMs: number;
  historyMs: number;
  memoryMs: number | null;
  totalMs: number;
  /** Tokens LLM consommés (P2). */
  totalTokens?: number;
  /** Diagnostic latence détaillé (temporaire — observabilité). */
  latencyDiag?: import("./latency-diag").LatencyDiag;
  /** Débit analyze effectué pour ce job (idempotence). */
  quotaCharged?: boolean;
};

export type AnalysisJob = {
  id: string;
  userId: string;
  documentId: string;
  historyId: string;
  fileName: string;
  status: AnalysisJobStatus;
  attempts: number;
  lastError?: string;
  claimedAt?: string;
  claimedBy?: string;
  leaseExpiresAt?: string;
  startedAt?: string;
  completedAt?: string;
  skipReadyReply: boolean;
  p1DurationMs?: number;
  userEmail?: string | null;
  pages?: string[];
  metrics?: AnalysisJobMetrics;
  createdAt: string;
  updatedAt: string;
};

export type AnalysisJobPublicStatus = {
  jobId: string;
  historyId: string;
  documentId: string;
  status: AnalysisJobStatus;
  /** Jobs pending créés avant celui-ci (+ 1 si self pending) — pas une ETA. */
  queuePosition: number | null;
  attempts: number;
  lastError?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  metrics?: AnalysisJobMetrics;
};
