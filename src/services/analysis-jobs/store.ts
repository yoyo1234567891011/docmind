/**
 * Persistance des jobs d'analyse.
 * - persistent : PostgreSQL (source de vérité)
 * - fs : fichier système (dev / e2e isolé)
 */
import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { canUseLocalFilesystem, usePersistentStorage } from "@/config/persistence";
import { SYSTEM_DIR } from "@/config/paths";
import { getPool, query } from "@/lib/db/pool";
import {
  LLM_SATURATION_REQUEUE_MESSAGE,
  sanitizeAnalysisFailureMessage,
  ANALYSIS_JOB_GLOBAL_TIMEOUT_MESSAGE,
  LLM_SATURATION_FAIL_MESSAGE,
  isTransientLlmSaturationError,
} from "@/lib/sanitize";
import {
  ANALYSIS_P2_MAX_CONCURRENCY,
  getEffectiveP2Concurrency,
} from "./p2-concurrency";

import type {
  AnalysisJob,
  AnalysisJobMetrics,
  AnalysisJobStatus,
} from "./types";

const FS_JOBS_FILE = path.join(SYSTEM_DIR, "analysis-jobs.json");

/** Lease job processing (heartbeat). */
export const ANALYSIS_JOB_LEASE_MS = 180_000;

/** Durée max wall-clock P2 (1 claim) — au-delà → échec propre, pas de hang. */
export const ANALYSIS_P2_WALL_TIMEOUT_MS = 180_000;

/** Budget temps total job (tous attempts + cooldowns) depuis created_at. */
export const ANALYSIS_JOB_GLOBAL_TIMEOUT_MS = 600_000;

/** Temps restant minimal pour tenter un requeue TPM (sinon fail propre). */
export const ANALYSIS_REQUEUE_MIN_REMAINING_MS = 40_000;

/** Remise en file après saturation : ne pas reclamer tout de suite. */
export const ANALYSIS_RATE_LIMIT_DEFER_MS = 22_000;

/** Au-delà → échec définitif (évite boucle infinie). */
export const ANALYSIS_MAX_TRANSIENT_ATTEMPTS = 8;

/**
 * @deprecated utiliser ANALYSIS_P2_MAX_CONCURRENCY (plafond) + getEffectiveP2Concurrency().
 */
export const ANALYSIS_P2_GLOBAL_CONCURRENCY = ANALYSIS_P2_MAX_CONCURRENCY;

/** Advisory lock PG pour claim mono-global (évite course multi-instance). */
const P2_CLAIM_ADVISORY_LOCK = 87_236_401;

/** Sérialise les claims FS (pas de SKIP LOCKED sans PG). */
let fsClaimChain: Promise<unknown> = Promise.resolve();

function withFsClaimLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = fsClaimChain.then(fn, fn);
  fsClaimChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

type FsFile = { jobs: AnalysisJob[] };

async function readFsJobs(): Promise<AnalysisJob[]> {
  if (!canUseLocalFilesystem()) return [];
  try {
    const raw = await readFile(FS_JOBS_FILE, "utf8");
    const parsed = JSON.parse(raw) as FsFile;
    return Array.isArray(parsed.jobs) ? parsed.jobs : [];
  } catch {
    return [];
  }
}

async function writeFsJobs(jobs: AnalysisJob[]): Promise<void> {
  if (!canUseLocalFilesystem()) return;
  await mkdir(SYSTEM_DIR, { recursive: true });
  await writeFile(
    FS_JOBS_FILE,
    JSON.stringify({ jobs: jobs.slice(0, 5000) } satisfies FsFile, null, 2),
    "utf8",
  );
}

export function getAnalysisJobAgeMs(
  job: Pick<AnalysisJob, "createdAt">,
): number {
  return Math.max(0, Date.now() - Date.parse(job.createdAt));
}

export function getAnalysisJobRemainingMs(
  job: Pick<AnalysisJob, "createdAt">,
): number {
  return Math.max(0, ANALYSIS_JOB_GLOBAL_TIMEOUT_MS - getAnalysisJobAgeMs(job));
}

export function isAnalysisJobGlobalTimeoutExceeded(
  job: Pick<AnalysisJob, "createdAt">,
): boolean {
  return getAnalysisJobAgeMs(job) >= ANALYSIS_JOB_GLOBAL_TIMEOUT_MS;
}

function expiredJobFailureMessage(job: Pick<AnalysisJob, "lastError">): string {
  return isTransientLlmSaturationError(job.lastError)
    ? LLM_SATURATION_FAIL_MESSAGE
    : ANALYSIS_JOB_GLOBAL_TIMEOUT_MESSAGE;
}

function rowToJob(row: {
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
  skip_ready_reply: boolean;
  p1_duration_ms: number | null;
  user_email: string | null;
  pages: unknown;
  metrics?: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}): AnalysisJob {
  const iso = (v: Date | string | null | undefined) =>
    v == null ? undefined : typeof v === "string" ? v : v.toISOString();
  const pages = Array.isArray(row.pages)
    ? row.pages.filter((p): p is string => typeof p === "string")
    : undefined;
  const metrics =
    row.metrics && typeof row.metrics === "object"
      ? (row.metrics as AnalysisJobMetrics)
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
    claimedAt: iso(row.claimed_at),
    claimedBy: row.claimed_by ?? undefined,
    leaseExpiresAt: iso(row.lease_expires_at),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    skipReadyReply: row.skip_ready_reply !== false,
    p1DurationMs: row.p1_duration_ms ?? undefined,
    userEmail: row.user_email,
    pages,
    metrics,
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
  };
}

/** Dernier job lié à un historyId (reprise UI / refresh). */
export async function findAnalysisJobByHistoryId(input: {
  userId: string;
  historyId: string;
}): Promise<AnalysisJob | null> {
  if (usePersistentStorage()) {
    const result = await query<{
      id: string;
      user_id: string;
      document_id: string;
      history_id: string;
      file_name: string;
      status: AnalysisJobStatus;
      attempts: number;
      last_error: string | null;
      claimed_at: Date | null;
      claimed_by: string | null;
      lease_expires_at: Date | null;
      started_at: Date | null;
      completed_at: Date | null;
      skip_ready_reply: boolean;
      p1_duration_ms: number | null;
      user_email: string | null;
      pages: unknown;
      metrics?: unknown;
      created_at: Date;
      updated_at: Date;
    }>(
      `select * from public.app_analysis_jobs
       where user_id = $1 and history_id = $2
       order by created_at desc
       limit 1`,
      [input.userId, input.historyId],
    );
    const row = result.rows[0];
    return row ? rowToJob(row) : null;
  }

  const jobs = await readFsJobs();
  return (
    jobs
      .filter(
        (j) => j.userId === input.userId && j.historyId === input.historyId,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}

export async function findActiveAnalysisJob(input: {
  userId: string;
  documentId: string;
}): Promise<AnalysisJob | null> {
  if (usePersistentStorage()) {
    const result = await query<{
      id: string;
      user_id: string;
      document_id: string;
      history_id: string;
      file_name: string;
      status: AnalysisJobStatus;
      attempts: number;
      last_error: string | null;
      claimed_at: Date | null;
      claimed_by: string | null;
      lease_expires_at: Date | null;
      started_at: Date | null;
      completed_at: Date | null;
      skip_ready_reply: boolean;
      p1_duration_ms: number | null;
      user_email: string | null;
      pages: unknown;
      created_at: Date;
      updated_at: Date;
    }>(
      `select * from public.app_analysis_jobs
       where user_id = $1 and document_id = $2
         and status in ('pending', 'processing')
       order by created_at asc
       limit 1`,
      [input.userId, input.documentId],
    );
    const row = result.rows[0];
    return row ? rowToJob(row) : null;
  }

  const jobs = await readFsJobs();
  return (
    jobs.find(
      (j) =>
        j.userId === input.userId &&
        j.documentId === input.documentId &&
        (j.status === "pending" || j.status === "processing"),
    ) ?? null
  );
}

export async function enqueueAnalysisJob(input: {
  userId: string;
  documentId: string;
  historyId: string;
  fileName: string;
  skipReadyReply?: boolean;
  p1DurationMs?: number;
  userEmail?: string | null;
  pages?: string[];
}): Promise<AnalysisJob> {
  const existing = await findActiveAnalysisJob({
    userId: input.userId,
    documentId: input.documentId,
  });
  if (existing) return existing;

  const now = new Date().toISOString();
  const job: AnalysisJob = {
    id: randomUUID(),
    userId: input.userId,
    documentId: input.documentId,
    historyId: input.historyId,
    fileName: input.fileName,
    status: "pending",
    attempts: 0,
    skipReadyReply: input.skipReadyReply !== false,
    p1DurationMs: input.p1DurationMs,
    userEmail: input.userEmail ?? null,
    pages: input.pages,
    createdAt: now,
    updatedAt: now,
  };

  if (usePersistentStorage()) {
    try {
      await query(
        `insert into public.app_analysis_jobs
          (id, user_id, document_id, history_id, file_name, status, attempts,
           skip_ready_reply, p1_duration_ms, user_email, pages, created_at, updated_at)
         values ($1,$2,$3,$4,$5,'pending',0,$6,$7,$8,$9::jsonb,
           timezone('utc', now()), timezone('utc', now()))`,
        [
          job.id,
          job.userId,
          job.documentId,
          job.historyId,
          job.fileName,
          job.skipReadyReply,
          job.p1DurationMs ?? null,
          job.userEmail ?? null,
          JSON.stringify(job.pages ?? null),
        ],
      );
      return job;
    } catch (error) {
      // Course unique index : un autre worker a créé le job actif
      const again = await findActiveAnalysisJob({
        userId: input.userId,
        documentId: input.documentId,
      });
      if (again) return again;
      throw error;
    }
  }

  const jobs = await readFsJobs();
  const race = jobs.find(
    (j) =>
      j.userId === input.userId &&
      j.documentId === input.documentId &&
      (j.status === "pending" || j.status === "processing"),
  );
  if (race) return race;
  jobs.unshift(job);
  await writeFsJobs(jobs);
  return job;
}

export async function getAnalysisJob(
  jobId: string,
  userId?: string,
): Promise<AnalysisJob | null> {
  if (usePersistentStorage()) {
    const result = await query<{
      id: string;
      user_id: string;
      document_id: string;
      history_id: string;
      file_name: string;
      status: AnalysisJobStatus;
      attempts: number;
      last_error: string | null;
      claimed_at: Date | null;
      claimed_by: string | null;
      lease_expires_at: Date | null;
      started_at: Date | null;
      completed_at: Date | null;
      skip_ready_reply: boolean;
      p1_duration_ms: number | null;
      user_email: string | null;
      pages: unknown;
      created_at: Date;
      updated_at: Date;
    }>(
      userId
        ? `select * from public.app_analysis_jobs where id = $1 and user_id = $2 limit 1`
        : `select * from public.app_analysis_jobs where id = $1 limit 1`,
      userId ? [jobId, userId] : [jobId],
    );
    const row = result.rows[0];
    return row ? rowToJob(row) : null;
  }

  const jobs = await readFsJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return null;
  if (userId && job.userId !== userId) return null;
  return job;
}

/**
 * Position approximative : 1 = prochain à traiter parmi les pending
 * (nombre de pending créés avant + 1). Null si plus en file.
 */
export async function getAnalysisJobQueuePosition(
  job: AnalysisJob,
): Promise<number | null> {
  if (job.status !== "pending") return null;

  if (usePersistentStorage()) {
    const result = await query<{ n: string }>(
      `select count(*)::text as n from public.app_analysis_jobs
       where status = 'pending' and created_at <= $1`,
      [job.createdAt],
    );
    const n = Number(result.rows[0]?.n ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  const jobs = await readFsJobs();
  const pending = jobs
    .filter((j) => j.status === "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const idx = pending.findIndex((j) => j.id === job.id);
  return idx < 0 ? null : idx + 1;
}

/**
 * Claim atomique : jusqu’à N jobs processing (N = concurrence effective ≤ MAX).
 * - pending claimable si lease_expires_at null ou passée (cooldown rate-limit)
 * - processing reclaimable si lease expirée
 * PG : advisory lock pour sérialiser le compteur busy multi-instance.
 */
export async function claimNextAnalysisJob(
  workerId: string,
  leaseMs = ANALYSIS_JOB_LEASE_MS,
): Promise<AnalysisJob | null> {
  const leaseIso = new Date(Date.now() + leaseMs).toISOString();
  const limit = await getEffectiveP2Concurrency();

  if (usePersistentStorage()) {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [
        P2_CLAIM_ADVISORY_LOCK,
      ]);

      const busy = await client.query<{ n: string }>(
        `select count(*)::text as n from public.app_analysis_jobs
         where status = 'processing'
           and lease_expires_at is not null
           and lease_expires_at >= timezone('utc', now())`,
      );
      const busyCount = Number(busy.rows[0]?.n ?? 0);
      if (busyCount >= limit) {
        await client.query("COMMIT");
        return null;
      }

      const result = await client.query<{
        id: string;
        user_id: string;
        document_id: string;
        history_id: string;
        file_name: string;
        status: AnalysisJobStatus;
        attempts: number;
        last_error: string | null;
        claimed_at: Date | null;
        claimed_by: string | null;
        lease_expires_at: Date | null;
        started_at: Date | null;
        completed_at: Date | null;
        skip_ready_reply: boolean;
        p1_duration_ms: number | null;
        user_email: string | null;
        pages: unknown;
        created_at: Date;
        updated_at: Date;
      }>(
        `with next as (
           select id from public.app_analysis_jobs
           where (
             status = 'pending'
             and (lease_expires_at is null
                  or lease_expires_at < timezone('utc', now()))
           )
           or (
             status = 'processing'
             and lease_expires_at is not null
             and lease_expires_at < timezone('utc', now())
           )
           order by created_at asc
           for update skip locked
           limit 1
         )
         update public.app_analysis_jobs j
         set status = 'processing',
             attempts = j.attempts + 1,
             claimed_at = timezone('utc', now()),
             claimed_by = $1,
             lease_expires_at = $2::timestamptz,
             started_at = coalesce(j.started_at, timezone('utc', now())),
             updated_at = timezone('utc', now()),
             last_error = case
               when j.status = 'processing' then coalesce(j.last_error, 'reclaimed_stale_lease')
               else j.last_error
             end
         from next
         where j.id = next.id
         returning j.*`,
        [workerId, leaseIso],
      );
      await client.query("COMMIT");
      const row = result.rows[0];
      return row ? rowToJob(row) : null;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  // FS : claim mono-process + plafond concurrence effective
  return withFsClaimLock(async () => {
    const jobs = await readFsJobs();
    const now = Date.now();

    const busyCount = jobs.filter(
      (j) =>
        j.status === "processing" &&
        j.leaseExpiresAt &&
        Date.parse(j.leaseExpiresAt) >= now,
    ).length;
    if (busyCount >= limit) {
      return null;
    }

    const sortedPending = jobs
      .map((j, i) => ({ j, i }))
      .filter(({ j }) => {
        if (j.status === "pending") {
          if (!j.leaseExpiresAt) return true;
          return Date.parse(j.leaseExpiresAt) < now;
        }
        if (j.status === "processing" && j.leaseExpiresAt) {
          return Date.parse(j.leaseExpiresAt) < now;
        }
        return false;
      })
      .sort((a, b) => a.j.createdAt.localeCompare(b.j.createdAt));
    const pick = sortedPending[0];
    if (!pick) return null;

    const nowIso = new Date().toISOString();
    const updated: AnalysisJob = {
      ...pick.j,
      status: "processing",
      attempts: pick.j.attempts + 1,
      claimedAt: nowIso,
      claimedBy: workerId,
      leaseExpiresAt: leaseIso,
      startedAt: pick.j.startedAt ?? nowIso,
      updatedAt: nowIso,
      lastError:
        pick.j.status === "processing"
          ? pick.j.lastError ?? "reclaimed_stale_lease"
          : pick.j.lastError,
    };
    jobs[pick.i] = updated;
    await writeFsJobs(jobs);
    return updated;
  });
}

/**
 * Remet un job en pending après saturation temporaire (429 / TPM).
 * `lease_expires_at` sert de cooldown avant le prochain claim.
 */
export async function requeueAnalysisJob(
  jobId: string,
  errorMessage?: string,
  deferMs = ANALYSIS_RATE_LIMIT_DEFER_MS,
): Promise<void> {
  const now = new Date().toISOString();
  const deferIso = new Date(Date.now() + Math.max(5_000, deferMs)).toISOString();
  let msg = (errorMessage?.trim() || LLM_SATURATION_REQUEUE_MESSAGE).slice(0, 500);
  if (msg.trim().startsWith("{") || /rate_limit_exceeded|"error"/i.test(msg)) {
    msg = LLM_SATURATION_REQUEUE_MESSAGE;
  } else if (/rate_limit|tokens per minute|\bTPM\b/i.test(msg)) {
    msg = LLM_SATURATION_REQUEUE_MESSAGE;
  }

  if (usePersistentStorage()) {
    await query(
      `update public.app_analysis_jobs
       set status = 'pending',
           claimed_at = null,
           claimed_by = null,
           lease_expires_at = $2::timestamptz,
           completed_at = null,
           last_error = $3,
           updated_at = timezone('utc', now())
       where id = $1 and status = 'processing'`,
      [jobId, deferIso, msg],
    );
    return;
  }

  const jobs = await readFsJobs();
  const idx = jobs.findIndex((j) => j.id === jobId);
  if (idx < 0) return;
  if (jobs[idx]!.status !== "processing") return;
  jobs[idx] = {
    ...jobs[idx]!,
    status: "pending",
    claimedAt: undefined,
    claimedBy: undefined,
    leaseExpiresAt: deferIso,
    completedAt: undefined,
    lastError: msg,
    updatedAt: now,
  };
  await writeFsJobs(jobs);
}

export async function heartbeatAnalysisJob(
  jobId: string,
  workerId: string,
  leaseMs = ANALYSIS_JOB_LEASE_MS,
): Promise<boolean> {
  const leaseIso = new Date(Date.now() + leaseMs).toISOString();
  if (usePersistentStorage()) {
    const result = await query(
      `update public.app_analysis_jobs
       set lease_expires_at = $2::timestamptz, updated_at = timezone('utc', now())
       where id = $1 and status = 'processing' and claimed_by = $3`,
      [jobId, leaseIso, workerId],
    );
    return (result.rowCount ?? 0) > 0;
  }
  const jobs = await readFsJobs();
  const idx = jobs.findIndex(
    (j) =>
      j.id === jobId && j.status === "processing" && j.claimedBy === workerId,
  );
  if (idx < 0) return false;
  jobs[idx] = {
    ...jobs[idx]!,
    leaseExpiresAt: leaseIso,
    updatedAt: new Date().toISOString(),
  };
  await writeFsJobs(jobs);
  return true;
}

export async function completeAnalysisJob(
  jobId: string,
  metrics?: AnalysisJobMetrics,
): Promise<boolean> {
  const now = new Date().toISOString();
  if (usePersistentStorage()) {
    const result = await query(
      `update public.app_analysis_jobs
       set status = 'completed',
           completed_at = timezone('utc', now()),
           lease_expires_at = null,
           last_error = null,
           metrics = coalesce($2::jsonb, metrics),
           updated_at = timezone('utc', now())
       where id = $1 and status = 'processing'`,
      [jobId, metrics ? JSON.stringify(metrics) : null],
    );
    return (result.rowCount ?? 0) > 0;
  }
  const jobs = await readFsJobs();
  const idx = jobs.findIndex(
    (j) => j.id === jobId && j.status === "processing",
  );
  if (idx < 0) return false;
  jobs[idx] = {
    ...jobs[idx]!,
    status: "completed",
    completedAt: now,
    leaseExpiresAt: undefined,
    lastError: undefined,
    metrics: metrics ?? jobs[idx]!.metrics,
    updatedAt: now,
  };
  await writeFsJobs(jobs);
  return true;
}

/** Marque le job comme facturé — retourne true si ce worker doit débiter. */
export async function tryClaimAnalysisJobQuotaCharge(
  jobId: string,
): Promise<boolean> {
  if (usePersistentStorage()) {
    const result = await query(
      `update public.app_analysis_jobs
       set metrics = jsonb_set(
             coalesce(metrics, '{}'::jsonb),
             '{quotaCharged}',
             'true'::jsonb,
             true
           ),
           updated_at = timezone('utc', now())
       where id = $1
         and status = 'completed'
         and coalesce((metrics->>'quotaCharged')::boolean, false) = false
       returning id`,
      [jobId],
    );
    return (result.rowCount ?? 0) > 0;
  }
  const jobs = await readFsJobs();
  const idx = jobs.findIndex(
    (j) =>
      j.id === jobId &&
      j.status === "completed" &&
      !j.metrics?.quotaCharged,
  );
  if (idx < 0) return false;
  const prev = jobs[idx]!.metrics;
  jobs[idx] = {
    ...jobs[idx]!,
    metrics: {
      queueWaitMs: prev?.queueWaitMs ?? 0,
      lockWaitMs: prev?.lockWaitMs ?? 0,
      generateMs: prev?.generateMs ?? 0,
      historyMs: prev?.historyMs ?? 0,
      memoryMs: prev?.memoryMs ?? null,
      totalMs: prev?.totalMs ?? 0,
      totalTokens: prev?.totalTokens,
      latencyDiag: prev?.latencyDiag,
      quotaPrepaidAtEnqueue: prev?.quotaPrepaidAtEnqueue,
      quotaCharged: true,
    },
    updatedAt: new Date().toISOString(),
  };
  await writeFsJobs(jobs);
  return true;
}

/** Claim quota avant complete (jobs legacy sans prépaiement enqueue). */
export async function tryClaimAnalysisJobQuotaChargeInProcessing(
  jobId: string,
): Promise<boolean> {
  if (usePersistentStorage()) {
    const result = await query(
      `update public.app_analysis_jobs
       set metrics = jsonb_set(
             coalesce(metrics, '{}'::jsonb),
             '{quotaCharged}',
             'true'::jsonb,
             true
           ),
           updated_at = timezone('utc', now())
       where id = $1
         and status = 'processing'
         and coalesce((metrics->>'quotaPrepaidAtEnqueue')::boolean, false) = false
         and coalesce((metrics->>'quotaCharged')::boolean, false) = false
       returning id`,
      [jobId],
    );
    return (result.rowCount ?? 0) > 0;
  }
  const jobs = await readFsJobs();
  const idx = jobs.findIndex(
    (j) =>
      j.id === jobId &&
      j.status === "processing" &&
      !j.metrics?.quotaPrepaidAtEnqueue &&
      !j.metrics?.quotaCharged,
  );
  if (idx < 0) return false;
  const prev = jobs[idx]!.metrics;
  jobs[idx] = {
    ...jobs[idx]!,
    metrics: {
      queueWaitMs: prev?.queueWaitMs ?? 0,
      lockWaitMs: prev?.lockWaitMs ?? 0,
      generateMs: prev?.generateMs ?? 0,
      historyMs: prev?.historyMs ?? 0,
      memoryMs: prev?.memoryMs ?? null,
      totalMs: prev?.totalMs ?? 0,
      totalTokens: prev?.totalTokens,
      latencyDiag: prev?.latencyDiag,
      quotaCharged: true,
    },
    updatedAt: new Date().toISOString(),
  };
  await writeFsJobs(jobs);
  return true;
}

/** Quota analyze déjà consommé à l'enqueue (mode progressif). */
export async function markAnalysisJobQuotaPrepaid(jobId: string): Promise<void> {
  if (usePersistentStorage()) {
    await query(
      `update public.app_analysis_jobs
       set metrics = jsonb_set(
             coalesce(metrics, '{}'::jsonb),
             '{quotaPrepaidAtEnqueue}',
             'true'::jsonb,
             true
           ),
           updated_at = timezone('utc', now())
       where id = $1`,
      [jobId],
    );
    return;
  }
  const jobs = await readFsJobs();
  const idx = jobs.findIndex((j) => j.id === jobId);
  if (idx < 0) return;
  const prev = jobs[idx]!.metrics;
  jobs[idx] = {
    ...jobs[idx]!,
    metrics: {
      queueWaitMs: prev?.queueWaitMs ?? 0,
      lockWaitMs: prev?.lockWaitMs ?? 0,
      generateMs: prev?.generateMs ?? 0,
      historyMs: prev?.historyMs ?? 0,
      memoryMs: prev?.memoryMs ?? null,
      totalMs: prev?.totalMs ?? 0,
      totalTokens: prev?.totalTokens,
      latencyDiag: prev?.latencyDiag,
      quotaCharged: prev?.quotaCharged,
      quotaPrepaidAtEnqueue: true,
    },
    updatedAt: new Date().toISOString(),
  };
  await writeFsJobs(jobs);
}

/** Annule le claim quota (si consumeQuota a échoué après claim). */
export async function releaseAnalysisJobQuotaCharge(
  jobId: string,
): Promise<void> {
  if (usePersistentStorage()) {
    await query(
      `update public.app_analysis_jobs
       set metrics = (coalesce(metrics, '{}'::jsonb) - 'quotaCharged'),
           updated_at = timezone('utc', now())
       where id = $1 and status in ('processing', 'completed')`,
      [jobId],
    );
    return;
  }
  const jobs = await readFsJobs();
  const idx = jobs.findIndex(
    (j) =>
      j.id === jobId &&
      (j.status === "processing" || j.status === "completed"),
  );
  if (idx < 0) return;
  const prev = jobs[idx]!.metrics;
  if (!prev?.quotaCharged) return;
  jobs[idx] = {
    ...jobs[idx]!,
    metrics: {
      queueWaitMs: prev.queueWaitMs ?? 0,
      lockWaitMs: prev.lockWaitMs ?? 0,
      generateMs: prev.generateMs ?? 0,
      historyMs: prev.historyMs ?? 0,
      memoryMs: prev.memoryMs ?? null,
      totalMs: prev.totalMs ?? 0,
      totalTokens: prev.totalTokens,
      latencyDiag: prev.latencyDiag,
    },
    updatedAt: new Date().toISOString(),
  };
  await writeFsJobs(jobs);
}

export async function failAnalysisJob(
  jobId: string,
  errorMessage: string,
  metrics?: AnalysisJobMetrics,
): Promise<void> {
  const now = new Date().toISOString();
  const msg = sanitizeAnalysisFailureMessage(errorMessage).slice(0, 500);
  if (usePersistentStorage()) {
    await query(
      `update public.app_analysis_jobs
       set status = 'failed',
           completed_at = timezone('utc', now()),
           lease_expires_at = null,
           claimed_at = null,
           claimed_by = null,
           last_error = $2,
           metrics = coalesce($3::jsonb, metrics),
           updated_at = timezone('utc', now())
       where id = $1 and status in ('pending', 'processing')`,
      [jobId, msg, metrics ? JSON.stringify(metrics) : null],
    );
    return;
  }
  const jobs = await readFsJobs();
  const idx = jobs.findIndex(
    (j) =>
      j.id === jobId &&
      (j.status === "pending" || j.status === "processing"),
  );
  if (idx < 0) return;
  jobs[idx] = {
    ...jobs[idx]!,
    status: "failed",
    completedAt: now,
    leaseExpiresAt: undefined,
    claimedAt: undefined,
    claimedBy: undefined,
    lastError: msg,
    metrics: metrics ?? jobs[idx]!.metrics,
    updatedAt: now,
  };
  await writeFsJobs(jobs);
}

/** Échec définitif d’un job expiré (budget global épuisé). */
export async function failExpiredAnalysisJob(job: AnalysisJob): Promise<boolean> {
  if (job.status !== "pending" && job.status !== "processing") return false;
  if (!isAnalysisJobGlobalTimeoutExceeded(job)) return false;
  const msg = expiredJobFailureMessage(job);
  await failAnalysisJob(job.id, msg);
  return true;
}

/**
 * Fait échouer les jobs pending/processing dépassant le budget global.
 * Retourne les jobs expirés (pour sync history côté worker/API).
 */
export async function expireTimedOutAnalysisJobs(): Promise<AnalysisJob[]> {
  if (usePersistentStorage()) {
    const result = await query<{
      id: string;
      user_id: string;
      document_id: string;
      history_id: string;
      file_name: string;
      status: AnalysisJobStatus;
      attempts: number;
      last_error: string | null;
      claimed_at: Date | null;
      claimed_by: string | null;
      lease_expires_at: Date | null;
      started_at: Date | null;
      completed_at: Date | null;
      skip_ready_reply: boolean;
      p1_duration_ms: number | null;
      user_email: string | null;
      pages: unknown;
      metrics?: unknown;
      created_at: Date;
      updated_at: Date;
    }>(
      `update public.app_analysis_jobs
       set status = 'failed',
           completed_at = timezone('utc', now()),
           lease_expires_at = null,
           claimed_at = null,
           claimed_by = null,
           last_error = case
             when last_error is not null and (
               last_error ilike '%satur%'
               or last_error ilike '%rate_limit%'
               or last_error ilike '%TPM%'
               or last_error ilike '%file d''attente%'
             ) then $1
             else $2
           end,
           updated_at = timezone('utc', now())
       where status in ('pending', 'processing')
         and created_at < timezone('utc', now())
           - ($3::double precision / 1000.0) * interval '1 second'
       returning *`,
      [
        LLM_SATURATION_FAIL_MESSAGE,
        ANALYSIS_JOB_GLOBAL_TIMEOUT_MESSAGE,
        ANALYSIS_JOB_GLOBAL_TIMEOUT_MS,
      ],
    );
    return result.rows.map((row) => rowToJob(row));
  }

  const jobs = await readFsJobs();
  const expired: AnalysisJob[] = [];
  const nowIso = new Date().toISOString();
  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i]!;
    if (job.status !== "pending" && job.status !== "processing") continue;
    if (!isAnalysisJobGlobalTimeoutExceeded(job)) continue;
    const failed: AnalysisJob = {
      ...job,
      status: "failed",
      completedAt: nowIso,
      leaseExpiresAt: undefined,
      claimedAt: undefined,
      claimedBy: undefined,
      lastError: expiredJobFailureMessage(job),
      updatedAt: nowIso,
    };
    jobs[i] = failed;
    expired.push(failed);
  }
  if (expired.length > 0) await writeFsJobs(jobs);
  return expired;
}

/** Supprime tous les jobs liés à une analyse (history delete cascade). */
export async function deleteAnalysisJobsForHistory(
  userId: string,
  historyId: string,
): Promise<number> {
  if (usePersistentStorage()) {
    const result = await query(
      `delete from public.app_analysis_jobs
       where user_id = $1 and history_id = $2`,
      [userId, historyId],
    );
    return result.rowCount ?? 0;
  }
  const jobs = await readFsJobs();
  const next = jobs.filter(
    (job) => !(job.userId === userId && job.historyId === historyId),
  );
  const removed = jobs.length - next.length;
  if (removed > 0) await writeFsJobs(next);
  return removed;
}

/** Test helper — reset FS store. */
export async function __resetAnalysisJobsFsForTests(): Promise<void> {
  await writeFsJobs([]);
}

export type AnalysisJobStats = {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  /** Jobs reclaimés au moins une fois (last_error / attempts). */
  reclaimed: number;
};

/** Compteurs globaux (observabilité load / admin). */
export async function getAnalysisJobStats(): Promise<AnalysisJobStats> {
  if (usePersistentStorage()) {
    const result = await query<{
      status: string;
      n: string;
    }>(
      `select status, count(*)::text as n
       from public.app_analysis_jobs
       group by status`,
    );
    const stats: AnalysisJobStats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      reclaimed: 0,
    };
    for (const row of result.rows) {
      const n = Number(row.n) || 0;
      if (row.status === "pending") stats.pending = n;
      else if (row.status === "processing") stats.processing = n;
      else if (row.status === "completed") stats.completed = n;
      else if (row.status === "failed") stats.failed = n;
    }
    const reclaimed = await query<{ n: string }>(
      `select count(*)::text as n from public.app_analysis_jobs
       where attempts > 1
          or last_error = 'reclaimed_stale_lease'
          or coalesce(last_error, '') like 'reclaimed%'`,
    );
    stats.reclaimed = Number(reclaimed.rows[0]?.n) || 0;
    return stats;
  }

  const jobs = await readFsJobs();
  const stats: AnalysisJobStats = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    reclaimed: 0,
  };
  for (const j of jobs) {
    if (j.status === "pending") stats.pending += 1;
    else if (j.status === "processing") stats.processing += 1;
    else if (j.status === "completed") stats.completed += 1;
    else if (j.status === "failed") stats.failed += 1;
    if (
      j.attempts > 1 ||
      j.lastError === "reclaimed_stale_lease" ||
      (j.lastError ?? "").startsWith("reclaimed")
    ) {
      stats.reclaimed += 1;
    }
  }
  return stats;
}
