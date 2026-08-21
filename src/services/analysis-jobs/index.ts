export type {
  AnalysisJob,
  AnalysisJobPublicStatus,
  AnalysisJobStatus,
} from "./types";
export { ANALYSIS_JOB_STATUSES } from "./types";

export {
  ANALYSIS_JOB_LEASE_MS,
  ANALYSIS_MAX_TRANSIENT_ATTEMPTS,
  ANALYSIS_P2_GLOBAL_CONCURRENCY,
  ANALYSIS_RATE_LIMIT_DEFER_MS,
  __resetAnalysisJobsFsForTests,
  claimNextAnalysisJob,
  completeAnalysisJob,
  enqueueAnalysisJob,
  failAnalysisJob,
  requeueAnalysisJob,
  findActiveAnalysisJob,
  findAnalysisJobByHistoryId,
  deleteAnalysisJobsForHistory,
  getAnalysisJob,
  getAnalysisJobQueuePosition,
  getAnalysisJobStats,
  heartbeatAnalysisJob,
} from "./store";
export type { AnalysisJobStats } from "./store";

export {
  ANALYSIS_P2_MAX_CONCURRENCY,
  ANALYSIS_P2_THROTTLE_FLOOR,
  getEffectiveP2Concurrency,
  noteP2RateLimitHit,
  noteP2Success,
  __resetP2ConcurrencyForTests,
} from "./p2-concurrency";

export {
  drainAnalysisJobs,
  processOneAnalysisJob,
  type AnalysisJobWorkerDeps,
  type ProcessAnalysisJobOutcome,
} from "./worker";

export {
  scheduleAnalysisDrainKick,
  __resetAnalysisDrainKickForTests,
} from "./kick";

import { getAnalysisJob, getAnalysisJobQueuePosition } from "./store";
import type { AnalysisJobPublicStatus } from "./types";

export async function getAnalysisJobPublicStatus(
  jobId: string,
  userId: string,
): Promise<AnalysisJobPublicStatus | null> {
  const job = await getAnalysisJob(jobId, userId);
  if (!job) return null;
  const queuePosition = await getAnalysisJobQueuePosition(job);
  return {
    jobId: job.id,
    historyId: job.historyId,
    documentId: job.documentId,
    status: job.status,
    queuePosition,
    attempts: job.attempts,
    lastError: job.lastError,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    metrics: job.metrics,
  };
}
