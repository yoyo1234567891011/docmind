export type {
  AnalysisJob,
  AnalysisJobPublicStatus,
  AnalysisJobStatus,
} from "./types";
export { ANALYSIS_JOB_STATUSES } from "./types";

export {
  ANALYSIS_JOB_LEASE_MS,
  ANALYSIS_JOB_GLOBAL_TIMEOUT_MS,
  ANALYSIS_MAX_TRANSIENT_ATTEMPTS,
  ANALYSIS_P2_GLOBAL_CONCURRENCY,
  ANALYSIS_P2_WALL_TIMEOUT_MS,
  ANALYSIS_RATE_LIMIT_DEFER_MS,
  ANALYSIS_REQUEUE_MIN_REMAINING_MS,
  __resetAnalysisJobsFsForTests,
  claimNextAnalysisJob,
  completeAnalysisJob,
  enqueueAnalysisJob,
  expireTimedOutAnalysisJobs,
  failAnalysisJob,
  failExpiredAnalysisJob,
  getAnalysisJobAgeMs,
  getAnalysisJobRemainingMs,
  isAnalysisJobGlobalTimeoutExceeded,
  requeueAnalysisJob,
  findActiveAnalysisJob,
  findAnalysisJobByHistoryId,
  deleteAnalysisJobsForHistory,
  getAnalysisJob,
  getAnalysisJobQueuePosition,
  getAnalysisJobStats,
  heartbeatAnalysisJob,
  markAnalysisJobQuotaPrepaid,
} from "./store";
export type { AnalysisJobStats } from "./store";

export {
  ANALYSIS_P2_MAX_CONCURRENCY,
  ANALYSIS_P2_THROTTLE_FLOOR,
  getEffectiveP2Concurrency,
  noteP2RateLimitHit,
  noteP2Success,
  noteP2GroqTokenUsage,
  getP2TpmSpacingRemainingMs,
  waitForP2TpmSpacing,
  noteP2GroqRateLimitCooldown,
  __resetP2ConcurrencyForTests,
} from "./p2-concurrency";

export {
  drainAnalysisJobs,
  processOneAnalysisJob,
  type AnalysisJobWorkerDeps,
  type ProcessAnalysisJobOutcome,
} from "./worker";

export {
  classifyP2Error,
  shouldRequeueAfterP2Failure,
  computeRequeueDeferMs,
  type P2ErrorClass,
} from "./requeue-policy";

export {
  scheduleAnalysisDrainKick,
  __resetAnalysisDrainKickForTests,
} from "./kick";

import {
  getAnalysisJob,
  getAnalysisJobQueuePosition,
  failExpiredAnalysisJob,
  isAnalysisJobGlobalTimeoutExceeded,
} from "./store";
import type { AnalysisJobPublicStatus } from "./types";
import { updateHistoryRecord } from "@/services/history";

export async function getAnalysisJobPublicStatus(
  jobId: string,
  userId: string,
): Promise<AnalysisJobPublicStatus | null> {
  let job = await getAnalysisJob(jobId, userId);
  if (!job) return null;

  if (
    (job.status === "pending" || job.status === "processing") &&
    isAnalysisJobGlobalTimeoutExceeded(job)
  ) {
    const expired = await failExpiredAnalysisJob(job);
    if (expired) {
      await updateHistoryRecord(job.userId, job.historyId, {
        analysisPhase: "failed",
      }).catch(() => undefined);
      job = (await getAnalysisJob(jobId, userId)) ?? job;
    }
  }

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
