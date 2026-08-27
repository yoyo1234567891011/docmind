/**
 * Tâches de nettoyage stockage (orphelins S3 après échec PG).
 * PG en mode persistent ; fichier système en mode FS.
 */
import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { canUseLocalFilesystem, usePersistentStorage } from "@/config/persistence";
import { SYSTEM_DIR } from "@/config/paths";
import { query } from "@/lib/db/pool";
import { deletePdfObject } from "@/lib/storage/s3";

const STORAGE_CLEANUP_JOBS_FILE = path.join(
  SYSTEM_DIR,
  "storage-cleanup-jobs.json",
);

export type StorageCleanupJobKind = "s3_orphan_delete";

export type StorageCleanupJobStatus = "pending" | "done" | "failed";

export type StorageCleanupJob = {
  id: string;
  kind: StorageCleanupJobKind;
  userId: string;
  documentId: string;
  storageKey: string;
  reason: string;
  attempts: number;
  status: StorageCleanupJobStatus;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
};

type FsFile = { jobs: StorageCleanupJob[] };

async function readFsJobs(): Promise<StorageCleanupJob[]> {
  if (!canUseLocalFilesystem()) return [];
  try {
    const raw = await readFile(STORAGE_CLEANUP_JOBS_FILE, "utf8");
    const parsed = JSON.parse(raw) as FsFile;
    return Array.isArray(parsed.jobs) ? parsed.jobs : [];
  } catch {
    return [];
  }
}

async function writeFsJobs(jobs: StorageCleanupJob[]): Promise<void> {
  if (!canUseLocalFilesystem()) return;
  await mkdir(SYSTEM_DIR, { recursive: true });
  await writeFile(
    STORAGE_CLEANUP_JOBS_FILE,
    JSON.stringify({ jobs: jobs.slice(0, 2000) } satisfies FsFile, null, 2),
    "utf8",
  );
}

export async function enqueueStorageCleanupJob(input: {
  kind: StorageCleanupJobKind;
  userId: string;
  documentId: string;
  storageKey: string;
  reason: string;
  lastError?: string;
}): Promise<StorageCleanupJob> {
  const now = new Date().toISOString();
  const job: StorageCleanupJob = {
    id: randomUUID(),
    kind: input.kind,
    userId: input.userId,
    documentId: input.documentId,
    storageKey: input.storageKey,
    reason: input.reason,
    attempts: 0,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    lastError: input.lastError,
  };

  if (usePersistentStorage()) {
    await query(
      `insert into public.app_storage_cleanup_jobs
        (id, kind, user_id, document_id, storage_key, reason, attempts, status, last_error, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, 0, 'pending', $7, timezone('utc', now()), timezone('utc', now()))`,
      [
        job.id,
        job.kind,
        job.userId,
        job.documentId,
        job.storageKey,
        job.reason,
        job.lastError ?? null,
      ],
    );
    console.error(
      `[storage-cleanup] enqueued id=${job.id} key=${job.storageKey} reason=${job.reason}`,
    );
    return job;
  }

  const jobs = await readFsJobs();
  jobs.unshift(job);
  await writeFsJobs(jobs);
  console.error(
    `[storage-cleanup] enqueued(fs) id=${job.id} key=${job.storageKey} reason=${job.reason}`,
  );
  return job;
}

export async function listPendingStorageCleanupJobs(
  limit = 50,
): Promise<StorageCleanupJob[]> {
  if (usePersistentStorage()) {
    const result = await query<{
      id: string;
      kind: StorageCleanupJobKind;
      user_id: string;
      document_id: string;
      storage_key: string;
      reason: string;
      attempts: number;
      status: StorageCleanupJobStatus;
      last_error: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `select id, kind, user_id, document_id, storage_key, reason, attempts, status,
              last_error, created_at, updated_at
       from public.app_storage_cleanup_jobs
       where status = 'pending'
       order by created_at asc
       limit $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      userId: row.user_id,
      documentId: row.document_id,
      storageKey: row.storage_key,
      reason: row.reason,
      attempts: row.attempts,
      status: row.status,
      lastError: row.last_error ?? undefined,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  return (await readFsJobs())
    .filter((j) => j.status === "pending")
    .slice(0, limit);
}

async function markJob(
  job: StorageCleanupJob,
  patch: Partial<
    Pick<StorageCleanupJob, "status" | "attempts" | "lastError" | "updatedAt">
  >,
): Promise<void> {
  const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
  if (usePersistentStorage()) {
    await query(
      `update public.app_storage_cleanup_jobs
       set status = $2, attempts = $3, last_error = $4, updated_at = timezone('utc', now())
       where id = $1`,
      [job.id, next.status, next.attempts, next.lastError ?? null],
    );
    return;
  }
  const jobs = await readFsJobs();
  const idx = jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) jobs[idx] = next;
  await writeFsJobs(jobs);
}

/** Retry une tâche pending (delete S3). */
export async function retryStorageCleanupJob(
  job: StorageCleanupJob,
): Promise<StorageCleanupJob> {
  const attempts = job.attempts + 1;
  try {
    if (job.kind === "s3_orphan_delete") {
      await deletePdfObject(job.userId, job.documentId);
    }
    await markJob(job, { status: "done", attempts, lastError: undefined });
    return { ...job, status: "done", attempts, lastError: undefined };
  } catch (error) {
    const lastError =
      error instanceof Error ? error.message : String(error);
    const status: StorageCleanupJobStatus =
      attempts >= 8 ? "failed" : "pending";
    await markJob(job, { status, attempts, lastError });
    return { ...job, status, attempts, lastError };
  }
}

export async function processPendingStorageCleanupJobs(
  limit = 20,
): Promise<{ processed: number; done: number; failed: number }> {
  const pending = await listPendingStorageCleanupJobs(limit);
  let done = 0;
  let failed = 0;
  for (const job of pending) {
    const result = await retryStorageCleanupJob(job);
    if (result.status === "done") done += 1;
    if (result.status === "failed") failed += 1;
  }
  return { processed: pending.length, done, failed };
}
