import { usePersistentStorage } from "@/config/persistence";
import { query } from "@/lib/db/pool";
import {
  adminRequeueAnalysisJob,
  getAnalysisJob,
  getAnalysisJobAgeMs,
  scheduleAnalysisDrainKick,
} from "@/services/analysis-jobs";
import type { AnalysisJob, AnalysisJobStatus } from "@/services/analysis-jobs/types";
import type { AdminJobRow, AdminJobsListResult } from "@/types/admin-ops";

/** Seuil stuck fondateur : pending/processing sans avancement > 10 min. */
export const ADMIN_JOB_STUCK_MS = 10 * 60 * 1000;

function toIso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  return typeof v === "string" ? v : v.toISOString();
}

function isStuckJob(job: AnalysisJob, nowMs: number, thresholdMs: number): boolean {
  if (job.status !== "pending" && job.status !== "processing") return false;
  const age = nowMs - Date.parse(job.createdAt);
  if (age >= thresholdMs) return true;
  if (job.status === "processing" && job.leaseExpiresAt) {
    const lease = Date.parse(job.leaseExpiresAt);
    if (Number.isFinite(lease) && lease < nowMs) return true;
  }
  return false;
}

/** Sanitize : jamais de pages / extract. */
export function toAdminJobRow(
  job: AnalysisJob,
  nowMs = Date.now(),
  thresholdMs = ADMIN_JOB_STUCK_MS,
): AdminJobRow {
  const ageMs = getAnalysisJobAgeMs(job);
  let durationMs: number | null = null;
  if (job.metrics?.totalMs != null) durationMs = job.metrics.totalMs;
  else if (job.startedAt && job.completedAt) {
    durationMs = Math.max(
      0,
      Date.parse(job.completedAt) - Date.parse(job.startedAt),
    );
  }
  return {
    id: job.id,
    userId: job.userId,
    userEmail: job.userEmail ?? null,
    documentId: job.documentId,
    historyId: job.historyId,
    fileName: job.fileName,
    status: job.status,
    attempts: job.attempts,
    lastError: job.lastError?.slice(0, 500) ?? null,
    ageMs,
    stuck: isStuckJob(job, nowMs, thresholdMs),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt ?? null,
    completedAt: job.completedAt ?? null,
    leaseExpiresAt: job.leaseExpiresAt ?? null,
    durationMs,
  };
}

function rowToMinimalJob(row: {
  id: string;
  user_id: string;
  document_id: string;
  history_id: string;
  file_name: string;
  status: AnalysisJobStatus;
  attempts: number;
  last_error: string | null;
  claimed_at: Date | string | null;
  claimed_by: string | null;
  lease_expires_at: Date | string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  user_email: string | null;
  metrics?: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}): AnalysisJob {
  const metrics =
    row.metrics && typeof row.metrics === "object"
      ? (row.metrics as AnalysisJob["metrics"])
      : undefined;
  return {
    id: row.id,
    userId: row.user_id,
    documentId: row.document_id,
    historyId: row.history_id,
    fileName: row.file_name,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error ?? undefined,
    claimedAt: toIso(row.claimed_at) ?? undefined,
    claimedBy: row.claimed_by ?? undefined,
    leaseExpiresAt: toIso(row.lease_expires_at) ?? undefined,
    startedAt: toIso(row.started_at) ?? undefined,
    completedAt: toIso(row.completed_at) ?? undefined,
    skipReadyReply: true,
    userEmail: row.user_email,
    // Intentionnellement omis : pages (extract PDF)
    metrics,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
  };
}

export type AdminJobsListQuery = {
  status?: AnalysisJobStatus | "stuck" | "all";
  userId?: string;
  limit?: number;
};

export async function listAdminAnalysisJobs(
  input: AdminJobsListQuery = {},
): Promise<AdminJobsListResult> {
  const nowMs = Date.now();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const statusFilter = input.status ?? "all";
  const stuckCutoff = new Date(nowMs - ADMIN_JOB_STUCK_MS).toISOString();

  let jobs: AnalysisJob[] = [];

  if (usePersistentStorage()) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (input.userId) {
      params.push(input.userId);
      where.push(`user_id = $${params.length}`);
    }
    if (statusFilter === "stuck") {
      params.push(stuckCutoff);
      where.push(
        `status in ('pending','processing') and (
           created_at <= $${params.length}::timestamptz
           or (status = 'processing' and lease_expires_at is not null and lease_expires_at < timezone('utc', now()))
         )`,
      );
    } else if (statusFilter !== "all") {
      params.push(statusFilter);
      where.push(`status = $${params.length}`);
    }
    params.push(limit);
    const sql = `
      select id, user_id, document_id, history_id, file_name, status, attempts,
             last_error, claimed_at, claimed_by, lease_expires_at, started_at,
             completed_at, user_email, metrics, created_at, updated_at
      from public.app_analysis_jobs
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by created_at desc
      limit $${params.length}
    `;
    const result = await query(sql, params);
    jobs = result.rows.map((r) =>
      rowToMinimalJob(
        r as Parameters<typeof rowToMinimalJob>[0],
      ),
    );
  } else {
    const { readFile } = await import("fs/promises");
    const path = await import("path");
    const { SYSTEM_DIR } = await import("@/config/paths");
    const { canUseLocalFilesystem } = await import("@/config/persistence");
    if (!canUseLocalFilesystem()) {
      jobs = [];
    } else {
      try {
        const raw = await readFile(
          path.join(SYSTEM_DIR, "analysis-jobs.json"),
          "utf8",
        );
        const parsed = JSON.parse(raw) as { jobs?: AnalysisJob[] };
        jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
      } catch {
        jobs = [];
      }
    }
    if (input.userId) {
      jobs = jobs.filter((j) => j.userId === input.userId);
    }
    if (statusFilter === "stuck") {
      jobs = jobs.filter((j) => isStuckJob(j, nowMs, ADMIN_JOB_STUCK_MS));
    } else if (statusFilter !== "all") {
      jobs = jobs.filter((j) => j.status === statusFilter);
    }
    jobs = [...jobs]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);
  }

  const rows = jobs.map((j) => toAdminJobRow(j, nowMs));

  // Counts globaux (pas seulement la page)
  const counts = await countAdminJobs(nowMs);

  return {
    at: new Date(nowMs).toISOString(),
    stuckThresholdMs: ADMIN_JOB_STUCK_MS,
    counts,
    jobs: rows,
  };
}

async function countAdminJobs(nowMs: number): Promise<AdminJobsListResult["counts"]> {
  const stuckCutoff = new Date(nowMs - ADMIN_JOB_STUCK_MS).toISOString();
  if (usePersistentStorage()) {
    try {
      const { rows } = await query<{
        pending: string;
        processing: string;
        completed: string;
        failed: string;
        stuck: string;
      }>(
        `select
           count(*) filter (where status = 'pending')::text as pending,
           count(*) filter (where status = 'processing')::text as processing,
           count(*) filter (where status = 'completed')::text as completed,
           count(*) filter (where status = 'failed')::text as failed,
           count(*) filter (
             where status in ('pending','processing')
               and (
                 created_at <= $1::timestamptz
                 or (status = 'processing' and lease_expires_at is not null
                     and lease_expires_at < timezone('utc', now()))
               )
           )::text as stuck
         from public.app_analysis_jobs`,
        [stuckCutoff],
      );
      const r = rows[0];
      return {
        pending: Number(r?.pending ?? 0),
        processing: Number(r?.processing ?? 0),
        completed: Number(r?.completed ?? 0),
        failed: Number(r?.failed ?? 0),
        stuck: Number(r?.stuck ?? 0),
      };
    } catch {
      /* fallthrough */
    }
  }
  return { pending: 0, processing: 0, completed: 0, failed: 0, stuck: 0 };
}

export async function countStuckAnalysisJobs(): Promise<number> {
  const counts = await countAdminJobs(Date.now());
  return counts.stuck;
}

export async function retryAdminAnalysisJob(jobId: string): Promise<AdminJobRow> {
  const existing = await getAnalysisJob(jobId);
  if (!existing) {
    throw new Error("Job introuvable");
  }
  if (existing.status === "completed") {
    throw new Error("Un job completed ne peut pas être relancé");
  }
  const updated = await adminRequeueAnalysisJob(
    jobId,
    `admin_retry: ${existing.lastError?.slice(0, 200) ?? "manual"}`,
  );
  if (!updated) {
    throw new Error("Retry impossible pour ce job");
  }
  scheduleAnalysisDrainKick(1);
  return toAdminJobRow(updated);
}

export async function listRecentJobsForUser(
  userId: string,
  limit = 10,
): Promise<AdminJobRow[]> {
  const result = await listAdminAnalysisJobs({
    userId,
    status: "all",
    limit,
  });
  return result.jobs;
}
