/**
 * Valide le mode persistent et signale les résidus FS encore présents.
 *
 * Usage:
 *   DOCMIND_STORAGE=persistent npx tsx scripts/validate-persistent-storage.ts
 */

import { access, readdir } from "fs/promises";
import path from "path";

import {
  getStorageBackend,
  isFsDualWriteEnabled,
  isFsFallbackEnabled,
  isS3Configured,
  usePersistentStorage,
} from "../src/config/persistence";
import { getPool, query } from "../src/lib/db/pool";
import { isRedisConfigured } from "../src/lib/redis";

const USERS_DIR = path.join(process.cwd(), "data", "users");

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function countFsUserTrees(): Promise<{
  users: number;
  withMemory: number;
  withSearch: number;
  withCache: number;
  withAlerts: number;
}> {
  if (!(await exists(USERS_DIR))) {
    return {
      users: 0,
      withMemory: 0,
      withSearch: 0,
      withCache: 0,
      withAlerts: 0,
    };
  }
  const entries = await readdir(USERS_DIR, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  let withMemory = 0;
  let withSearch = 0;
  let withCache = 0;
  let withAlerts = 0;
  for (const id of dirs) {
    if (await exists(path.join(USERS_DIR, id, "memory"))) withMemory += 1;
    if (await exists(path.join(USERS_DIR, id, "search-index"))) withSearch += 1;
    if (await exists(path.join(USERS_DIR, id, "analysis-cache"))) withCache += 1;
    if (await exists(path.join(USERS_DIR, id, "alerts-state.json"))) {
      withAlerts += 1;
    }
  }
  return {
    users: dirs.length,
    withMemory,
    withSearch,
    withCache,
    withAlerts,
  };
}

async function main(): Promise<void> {
  console.log("[validate] storage backend:", getStorageBackend());
  console.log("[validate] persistent:", usePersistentStorage());
  console.log("[validate] fs fallback:", isFsFallbackEnabled());
  console.log("[validate] fs dual-write:", isFsDualWriteEnabled());
  console.log("[validate] redis configured:", isRedisConfigured());
  console.log("[validate] s3 configured:", isS3Configured());

  if (!usePersistentStorage()) {
    console.log(
      "[validate] Mode FS — multi-instance NON scalable. Définir DOCMIND_STORAGE=persistent.",
    );
    process.exitCode = 2;
    return;
  }

  const required = [
    "app_subscriptions",
    "app_usage",
    "app_history",
    "app_documents",
    "app_user_blobs",
    "app_user_files",
    "stripe_webhook_events",
  ];
  for (const table of required) {
    const r = await query<{ exists: boolean }>(
      `select to_regclass($1) is not null as exists`,
      [`public.${table}`],
    );
    const ok = r.rows[0]?.exists;
    console.log(`[validate] table ${table}:`, ok ? "ok" : "MISSING");
    if (!ok) process.exitCode = 1;
  }

  const counts = await Promise.all([
    query<{ n: string }>(`select count(*)::text as n from public.app_history`),
    query<{ n: string }>(
      `select count(*)::text as n from public.app_user_files`,
    ),
    query<{ n: string }>(
      `select count(*)::text as n from public.app_user_blobs`,
    ),
    query<{ n: string }>(
      `select count(*)::text as n from public.app_documents`,
    ),
  ]);
  console.log("[validate] pg rows", {
    history: counts[0].rows[0]?.n,
    userFiles: counts[1].rows[0]?.n,
    userBlobs: counts[2].rows[0]?.n,
    documents: counts[3].rows[0]?.n,
  });

  const fs = await countFsUserTrees();
  console.log("[validate] fs residues", fs);

  if (isFsFallbackEnabled()) {
    console.log(
      "[validate] DOCMIND_FS_FALLBACK actif — lecture FS encore possible (migration).",
    );
    console.log(
      "[validate] Après smoke tests: DOCMIND_FS_FALLBACK=0 pour couper le FS.",
    );
  } else {
    console.log(
      "[validate] DOCMIND_FS_FALLBACK=0 — runtime ignore le FS utilisateur.",
    );
  }

  const scalable =
    usePersistentStorage() &&
    isRedisConfigured() &&
    isS3Configured() &&
    !isFsFallbackEnabled() &&
    process.exitCode !== 1;

  console.log(
    "[validate] SaaS horizontal scalable (sans FS):",
    scalable ? "OUI" : "PAS ENCORE",
  );
  if (!scalable && process.exitCode !== 1) {
    process.exitCode = 3;
  }

  await getPool().end();
}

main().catch((error) => {
  console.error("[validate] échec", error);
  process.exit(1);
});
