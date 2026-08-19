export type {
  AnalysisJob,
  AnalysisJobPublicStatus,
  AnalysisJobStatus,
} from "./types";
export { ANALYSIS_JOB_STATUSES } from "./types";

export {
  ANALYSIS_JOB_LEASE_MS,
  __resetAnalysisJobsFsForTests,
  claimNextAnalysisJob,
  completeAnalysisJob,
  enqueueAnalysisJob,
  failAnalysisJob,
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
  drainAnalysisJobs,
  processOneAnalysisJob,
  type AnalysisJobWorkerDeps,
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
