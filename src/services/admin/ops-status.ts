import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

import { canUseLocalFilesystem, usePersistentStorage } from "@/config/persistence";
import { ADMIN_DIR } from "@/config/paths";
import { query } from "@/lib/db/pool";
import type { AdminActionLogEntry } from "@/types/admin-ops";

const DRAIN_STATUS_FILE = path.join(ADMIN_DIR, "drain-status.json");
const ACTION_LOG_FILE = path.join(ADMIN_DIR, "action-log.json");
const MAX_ACTIONS = 200;

export type DrainStatus = {
  lastSuccessAt: string | null;
  lastProcessed: number | null;
  lastError: string | null;
};

const memoryDrain: DrainStatus = {
  lastSuccessAt: null,
  lastProcessed: null,
  lastError: null,
};

let memoryActions: AdminActionLogEntry[] = [];

async function ensureAdminDir(): Promise<void> {
  if (!canUseLocalFilesystem()) return;
  await mkdir(ADMIN_DIR, { recursive: true });
}

/** Enregistre le dernier drain cron (best-effort PG prod / FS local). */
export async function recordDrainSuccess(input: {
  processed: number;
}): Promise<void> {
  const next: DrainStatus = {
    lastSuccessAt: new Date().toISOString(),
    lastProcessed: input.processed,
    lastError: null,
  };
  Object.assign(memoryDrain, next);

  // Prod serverless : pas de FS — écrire PG en premier (sinon early-return perdu).
  if (usePersistentStorage()) {
    try {
      await ensureAdminKvTable();
      await query(
        `insert into public.app_admin_kv (key, data, updated_at)
         values ('drain_status', $1::jsonb, timezone('utc', now()))
         on conflict (key) do update
           set data = excluded.data, updated_at = timezone('utc', now())`,
        [JSON.stringify(next)],
      );
    } catch {
      /* non bloquant */
    }
  }

  if (canUseLocalFilesystem()) {
    try {
      await ensureAdminDir();
      await writeFile(DRAIN_STATUS_FILE, JSON.stringify(next, null, 2), "utf8");
    } catch {
      /* non bloquant */
    }
  }
}

export async function getDrainStatus(): Promise<DrainStatus> {
  if (usePersistentStorage()) {
    try {
      await ensureAdminKvTable();
      const { rows } = await query<{ data: DrainStatus }>(
        `select data from public.app_admin_kv where key = 'drain_status' limit 1`,
      );
      if (rows[0]?.data?.lastSuccessAt) return rows[0].data;
    } catch {
      /* ignore */
    }
  }
  if (canUseLocalFilesystem()) {
    try {
      const raw = await readFile(DRAIN_STATUS_FILE, "utf8");
      return JSON.parse(raw) as DrainStatus;
    } catch {
      /* ignore */
    }
  }
  return { ...memoryDrain };
}

async function ensureAdminKvTable(): Promise<void> {
  await query(`
    create table if not exists public.app_admin_kv (
      key text primary key,
      data jsonb not null,
      updated_at timestamptz not null default timezone('utc', now())
    )
  `);
}

export async function appendAdminActionLog(
  entry: Omit<AdminActionLogEntry, "id" | "at"> & { at?: string },
): Promise<void> {
  const full: AdminActionLogEntry = {
    id: randomUUID(),
    at: entry.at ?? new Date().toISOString(),
    action: entry.action,
    adminUserId: entry.adminUserId,
    targetUserId: entry.targetUserId ?? null,
    targetEmail: entry.targetEmail ?? null,
    ok: entry.ok,
    detail: entry.detail?.slice(0, 300) ?? null,
  };
  memoryActions = [full, ...memoryActions].slice(0, MAX_ACTIONS);
  if (!canUseLocalFilesystem()) return;
  try {
    await ensureAdminDir();
    let existing: AdminActionLogEntry[] = [];
    try {
      const raw = await readFile(ACTION_LOG_FILE, "utf8");
      existing = JSON.parse(raw) as AdminActionLogEntry[];
    } catch {
      existing = [];
    }
    existing = [full, ...existing].slice(0, MAX_ACTIONS);
    await writeFile(ACTION_LOG_FILE, JSON.stringify(existing, null, 2), "utf8");
  } catch {
    /* non bloquant */
  }
}

export async function listAdminActionLogs(
  limit = 30,
): Promise<AdminActionLogEntry[]> {
  if (canUseLocalFilesystem()) {
    try {
      const raw = await readFile(ACTION_LOG_FILE, "utf8");
      const existing = JSON.parse(raw) as AdminActionLogEntry[];
      return existing.slice(0, Math.min(limit, MAX_ACTIONS));
    } catch {
      /* ignore */
    }
  }
  return memoryActions.slice(0, limit);
}
