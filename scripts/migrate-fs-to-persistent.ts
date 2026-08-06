/**
 * Migration FS → PostgreSQL + Object Storage S3.
 *
 * Prérequis: DATABASE_URL, S3_*, tables migrées (supabase/migrations).
 * Usage: DOCMIND_STORAGE=fs npx tsx scripts/migrate-fs-to-persistent.ts
 *        (lit le FS local puis écrit PG/S3)
 *
 * Idempotent: upserts / overwrite S3.
 */

import { readFile, readdir, access } from "fs/promises";
import path from "path";

import { putPdfObject } from "../src/lib/storage/s3";
import { query, getPool } from "../src/lib/db/pool";
import type { HistoryRecord } from "../src/types";
import type { UserSubscriptionRecord } from "../src/types/billing";

const USERS_DIR = path.join(process.cwd(), "data", "users");
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function listUserIds(): Promise<string[]> {
  if (!(await exists(USERS_DIR))) return [];
  const entries = await readdir(USERS_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function migrateSubscription(userId: string): Promise<boolean> {
  const file = path.join(USERS_DIR, userId, "subscription.json");
  if (!(await exists(file))) return false;
  const raw = JSON.parse(await readFile(file, "utf8")) as UserSubscriptionRecord;
  await query(
    `insert into public.app_subscriptions
       (user_id, data, stripe_customer_id, stripe_subscription_id, updated_at)
     values ($1, $2::jsonb, $3, $4, timezone('utc', now()))
     on conflict (user_id) do update set
       data = excluded.data,
       stripe_customer_id = excluded.stripe_customer_id,
       stripe_subscription_id = excluded.stripe_subscription_id,
       updated_at = timezone('utc', now())`,
    [
      userId,
      JSON.stringify({ ...raw, userId }),
      raw.stripeCustomerId ?? null,
      raw.stripeSubscriptionId ?? null,
    ],
  );
  return true;
}

async function migrateUsage(userId: string): Promise<boolean> {
  const file = path.join(USERS_DIR, userId, "usage.json");
  if (!(await exists(file))) return false;
  const data = JSON.parse(await readFile(file, "utf8")) as {
    month?: string;
  };
  const month = data.month || new Date().toISOString().slice(0, 7);
  await query(
    `insert into public.app_usage (user_id, month, data, updated_at)
     values ($1, $2, $3::jsonb, timezone('utc', now()))
     on conflict (user_id, month) do update set
       data = excluded.data,
       updated_at = timezone('utc', now())`,
    [userId, month, JSON.stringify(data)],
  );
  return true;
}

async function migrateHistory(userId: string): Promise<number> {
  const dir = path.join(USERS_DIR, userId, "history");
  if (!(await exists(dir))) return 0;
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  let count = 0;
  for (const file of files) {
    const raw = JSON.parse(
      await readFile(path.join(dir, file), "utf8"),
    ) as HistoryRecord;
    if (!raw.id || !raw.userId) continue;
    await query(
      `insert into public.app_history (id, user_id, document_id, data, updated_at)
       values ($1, $2, $3, $4::jsonb, timezone('utc', now()))
       on conflict (user_id, id) do update set
         document_id = excluded.document_id,
         data = excluded.data,
         updated_at = timezone('utc', now())`,
      [raw.id, userId, raw.documentId ?? null, JSON.stringify(raw)],
    );
    count += 1;
  }
  return count;
}

async function migrateBlob(
  userId: string,
  fileName: string,
  key: string,
): Promise<boolean> {
  const file = path.join(USERS_DIR, userId, fileName);
  if (!(await exists(file))) return false;
  const data = JSON.parse(await readFile(file, "utf8"));
  await query(
    `insert into public.app_user_blobs (user_id, key, data, updated_at)
     values ($1, $2, $3::jsonb, timezone('utc', now()))
     on conflict (user_id, key) do update set
       data = excluded.data,
       updated_at = timezone('utc', now())`,
    [userId, key, JSON.stringify(data)],
  );
  return true;
}

async function walkFiles(dir: string, prefix = ""): Promise<string[]> {
  if (!(await exists(dir))) return [];
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(full, rel)));
    } else if (entry.isFile()) {
      out.push(rel.replace(/\\/g, "/"));
    }
  }
  return out;
}

/** Mémoire + index recherche (+ autres fichiers sous data/users/<id>). */
async function migrateUserFiles(userId: string): Promise<number> {
  const root = path.join(USERS_DIR, userId);
  if (!(await exists(root))) return 0;
  const skip = new Set([
    "subscription.json",
    "usage.json",
    "folders.json",
    "tags.json",
    "alerts-state.json",
  ]);
  const files = await walkFiles(root);
  let count = 0;
  for (const rel of files) {
    if (rel.startsWith("history/")) continue;
    if (skip.has(rel)) continue;
    const content = await readFile(path.join(root, rel), "utf8");
    await query(
      `insert into public.app_user_files (user_id, path, content, updated_at)
       values ($1, $2, $3, timezone('utc', now()))
       on conflict (user_id, path) do update set
         content = excluded.content,
         updated_at = timezone('utc', now())`,
      [userId, rel, content],
    );
    count += 1;
  }
  return count;
}

async function migratePdfs(userId: string): Promise<number> {
  const dir = path.join(UPLOADS_DIR, userId);
  if (!(await exists(dir))) return 0;
  const files = (await readdir(dir)).filter((f) => f.endsWith(".pdf"));
  let count = 0;
  for (const file of files) {
    const documentId = file.replace(/\.pdf$/i, "");
    const bytes = await readFile(path.join(dir, file));
    const { key } = await putPdfObject(userId, documentId, bytes);
    await query(
      `insert into public.app_documents
         (document_id, user_id, storage_key, file_name, size_bytes)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id, document_id) do update set
         storage_key = excluded.storage_key,
         size_bytes = excluded.size_bytes`,
      [documentId, userId, key, file, bytes.byteLength],
    );
    count += 1;
  }
  return count;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL requis");
  }
  if (!process.env.S3_BUCKET?.trim()) {
    throw new Error("S3_BUCKET requis");
  }

  const users = await listUserIds();
  console.log(`[migrate] ${users.length} utilisateur(s) sous data/users`);

  let subs = 0;
  let usages = 0;
  let history = 0;
  let folders = 0;
  let tags = 0;
  let alerts = 0;
  let userFiles = 0;
  let pdfs = 0;

  for (const userId of users) {
    if (await migrateSubscription(userId)) subs += 1;
    if (await migrateUsage(userId)) usages += 1;
    history += await migrateHistory(userId);
    if (await migrateBlob(userId, "folders.json", "folders")) folders += 1;
    if (await migrateBlob(userId, "tags.json", "tags")) tags += 1;
    if (await migrateBlob(userId, "alerts-state.json", "alerts-state")) {
      alerts += 1;
    }
    userFiles += await migrateUserFiles(userId);
    pdfs += await migratePdfs(userId);
    console.log(`[migrate] ok user=${userId}`);
  }

  console.log("[migrate] terminé", {
    users: users.length,
    subscriptions: subs,
    usage: usages,
    historyRecords: history,
    folders,
    tags,
    alerts,
    userFiles,
    pdfs,
  });
  console.log(
    "[migrate] Ensuite: DOCMIND_STORAGE=persistent + redémarrage app.",
  );

  await getPool().end();
}

main().catch((error) => {
  console.error("[migrate] échec", error);
  process.exit(1);
});
