/**
 * Backup / restore production pour DOCMIND_STORAGE=persistent.
 * Couvre : PostgreSQL (export logique tables app_*) + PDF S3 + manifeste SHA-256.
 *
 * Le backup FS (data/uploads) n’est PAS un backup production.
 */
import { createHash } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";

import { usePersistentStorage } from "@/config/persistence";
import {
  assertSafeResourceId,
  assertSafeUserId,
  BACKUPS_DIR,
} from "@/config/paths";
import { query } from "@/lib/db/pool";
import {
  getPdfObject,
  pdfObjectKey,
  putPdfObject,
} from "@/lib/storage/s3";

/** Tables critiques restaurées (ordre respecté à l’import). */
export const PERSISTENT_BACKUP_TABLES = [
  "app_subscriptions",
  "app_usage",
  "app_history",
  "app_documents",
  "app_user_blobs",
  "app_user_files",
  "stripe_webhook_events",
  "app_storage_cleanup_jobs",
  "app_analysis_jobs",
] as const;

export type PersistentBackupTable = (typeof PERSISTENT_BACKUP_TABLES)[number];

export type PersistentDocumentEntry = {
  userId: string;
  documentId: string;
  storageKey: string;
  relativePath: string;
  size: number;
  sha256: string;
  fileName?: string | null;
  sizeBytes?: number | null;
};

export type PersistentBackupManifest = {
  kind: "persistent";
  id: string;
  createdAt: string;
  postgres: {
    relativePath: string;
    sha256: string;
    size: number;
    tables: Record<string, number>;
  };
  documents: PersistentDocumentEntry[];
  totals: { documents: number; pdfBytes: number; postgresBytes: number };
};

export type PersistentBackupDeps = {
  listDocuments: () => Promise<
    Array<{
      userId: string;
      documentId: string;
      storageKey: string;
      fileName?: string | null;
      sizeBytes?: number | null;
    }>
  >;
  getPdf: (userId: string, documentId: string) => Promise<Buffer>;
  putPdf: (
    userId: string,
    documentId: string,
    bytes: Buffer,
  ) => Promise<{ key: string }>;
  exportTable: (table: PersistentBackupTable) => Promise<unknown[]>;
  restoreTable: (
    table: PersistentBackupTable,
    rows: unknown[],
  ) => Promise<void>;
  truncateTables?: (tables: readonly PersistentBackupTable[]) => Promise<void>;
};

function backupRoot(id: string): string {
  return path.join(BACKUPS_DIR, id);
}

function hashBuffer(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function assertSafeRelativePath(rel: string, root: string): string {
  const normalized = rel.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").some((p) => p === ".." || p === "")
  ) {
    throw new Error(`Chemin de restauration invalide: ${rel}`);
  }
  const abs = path.resolve(root, normalized);
  const rootResolved = path.resolve(root);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    throw new Error(`Chemin source hors backup: ${rel}`);
  }
  return normalized;
}

function assertSafePdfRelativePath(rel: string): {
  userId: string;
  documentId: string;
} {
  const normalized = rel.replace(/\\/g, "/");
  const match = /^pdfs\/([^/]+)\/([^/]+)\.pdf$/.exec(normalized);
  if (!match) {
    throw new Error(
      `Chemin PDF invalide (attendu pdfs/<userId>/<documentId>.pdf): ${rel}`,
    );
  }
  const userId = assertSafeUserId(match[1]!);
  const documentId = assertSafeResourceId(match[2]!, "documentId");
  return { userId, documentId };
}

async function defaultListDocuments() {
  const result = await query<{
    document_id: string;
    user_id: string;
    storage_key: string;
    file_name: string | null;
    size_bytes: string | number | null;
  }>(
    `select document_id, user_id, storage_key, file_name, size_bytes
     from public.app_documents
     order by user_id, document_id`,
  );
  return result.rows.map((row) => ({
    userId: row.user_id,
    documentId: row.document_id,
    storageKey: row.storage_key,
    fileName: row.file_name,
    sizeBytes:
      row.size_bytes == null
        ? null
        : typeof row.size_bytes === "number"
          ? row.size_bytes
          : Number(row.size_bytes),
  }));
}

async function defaultExportTable(
  table: PersistentBackupTable,
): Promise<unknown[]> {
  const result = await query(`select * from public.${table}`);
  return result.rows;
}

async function defaultTruncateTables(
  tables: readonly PersistentBackupTable[],
): Promise<void> {
  // Ordre inverse pour limiter les surprises (pas de FK formelles, mais propre).
  for (const table of [...tables].reverse()) {
    await query(`delete from public.${table}`);
  }
}

async function defaultRestoreTable(
  table: PersistentBackupTable,
  rows: unknown[],
): Promise<void> {
  if (rows.length === 0) return;

  if (table === "app_documents") {
    for (const raw of rows) {
      const row = raw as {
        document_id: string;
        user_id: string;
        storage_key: string;
        file_name?: string | null;
        size_bytes?: number | null;
        created_at?: string;
      };
      await query(
        `insert into public.app_documents
          (document_id, user_id, storage_key, file_name, size_bytes, created_at)
         values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, timezone('utc', now())))
         on conflict (user_id, document_id) do update set
           storage_key = excluded.storage_key,
           file_name = excluded.file_name,
           size_bytes = excluded.size_bytes`,
        [
          row.document_id,
          row.user_id,
          row.storage_key,
          row.file_name ?? null,
          row.size_bytes ?? null,
          row.created_at ?? null,
        ],
      );
    }
    return;
  }

  if (table === "app_history") {
    for (const raw of rows) {
      const row = raw as {
        id: string;
        user_id: string;
        document_id?: string | null;
        data: unknown;
        updated_at?: string;
      };
      await query(
        `insert into public.app_history (id, user_id, document_id, data, updated_at)
         values ($1, $2, $3, $4::jsonb, coalesce($5::timestamptz, timezone('utc', now())))
         on conflict (user_id, id) do update set
           document_id = excluded.document_id,
           data = excluded.data,
           updated_at = excluded.updated_at`,
        [
          row.id,
          row.user_id,
          row.document_id ?? null,
          JSON.stringify(row.data),
          row.updated_at ?? null,
        ],
      );
    }
    return;
  }

  if (table === "app_user_files") {
    for (const raw of rows) {
      const row = raw as {
        user_id: string;
        path: string;
        content: string;
        updated_at?: string;
      };
      await query(
        `insert into public.app_user_files (user_id, path, content, updated_at)
         values ($1, $2, $3, coalesce($4::timestamptz, timezone('utc', now())))
         on conflict (user_id, path) do update set
           content = excluded.content,
           updated_at = excluded.updated_at`,
        [row.user_id, row.path, row.content, row.updated_at ?? null],
      );
    }
    return;
  }

  if (table === "app_user_blobs") {
    for (const raw of rows) {
      const row = raw as {
        user_id: string;
        key: string;
        data: unknown;
        updated_at?: string;
      };
      await query(
        `insert into public.app_user_blobs (user_id, key, data, updated_at)
         values ($1, $2, $3::jsonb, coalesce($4::timestamptz, timezone('utc', now())))
         on conflict (user_id, key) do update set
           data = excluded.data,
           updated_at = excluded.updated_at`,
        [
          row.user_id,
          row.key,
          JSON.stringify(row.data),
          row.updated_at ?? null,
        ],
      );
    }
    return;
  }

  if (table === "app_subscriptions") {
    for (const raw of rows) {
      const row = raw as {
        user_id: string;
        data: unknown;
        stripe_customer_id?: string | null;
        stripe_subscription_id?: string | null;
        updated_at?: string;
      };
      await query(
        `insert into public.app_subscriptions
          (user_id, data, stripe_customer_id, stripe_subscription_id, updated_at)
         values ($1, $2::jsonb, $3, $4, coalesce($5::timestamptz, timezone('utc', now())))
         on conflict (user_id) do update set
           data = excluded.data,
           stripe_customer_id = excluded.stripe_customer_id,
           stripe_subscription_id = excluded.stripe_subscription_id,
           updated_at = excluded.updated_at`,
        [
          row.user_id,
          JSON.stringify(row.data),
          row.stripe_customer_id ?? null,
          row.stripe_subscription_id ?? null,
          row.updated_at ?? null,
        ],
      );
    }
    return;
  }

  if (table === "app_usage") {
    for (const raw of rows) {
      const row = raw as {
        user_id: string;
        month: string;
        data: unknown;
        updated_at?: string;
      };
      await query(
        `insert into public.app_usage (user_id, month, data, updated_at)
         values ($1, $2, $3::jsonb, coalesce($4::timestamptz, timezone('utc', now())))
         on conflict (user_id, month) do update set
           data = excluded.data,
           updated_at = excluded.updated_at`,
        [
          row.user_id,
          row.month,
          JSON.stringify(row.data),
          row.updated_at ?? null,
        ],
      );
    }
    return;
  }

  if (table === "stripe_webhook_events") {
    for (const raw of rows) {
      const row = raw as {
        event_id: string;
        event_type: string;
        processed_at?: string;
      };
      await query(
        `insert into public.stripe_webhook_events (event_id, event_type, processed_at)
         values ($1, $2, coalesce($3::timestamptz, timezone('utc', now())))
         on conflict (event_id) do nothing`,
        [row.event_id, row.event_type, row.processed_at ?? null],
      );
    }
    return;
  }

  if (table === "app_storage_cleanup_jobs") {
    for (const raw of rows) {
      const row = raw as {
        id: string;
        kind: string;
        user_id: string;
        document_id: string;
        storage_key: string;
        reason: string;
        attempts?: number;
        status?: string;
        last_error?: string | null;
        created_at?: string;
        updated_at?: string;
      };
      await query(
        `insert into public.app_storage_cleanup_jobs
          (id, kind, user_id, document_id, storage_key, reason, attempts, status, last_error, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,
           coalesce($10::timestamptz, timezone('utc', now())),
           coalesce($11::timestamptz, timezone('utc', now())))
         on conflict (id) do update set
           status = excluded.status,
           attempts = excluded.attempts,
           last_error = excluded.last_error,
           updated_at = excluded.updated_at`,
        [
          row.id,
          row.kind,
          row.user_id,
          row.document_id,
          row.storage_key,
          row.reason,
          row.attempts ?? 0,
          row.status ?? "pending",
          row.last_error ?? null,
          row.created_at ?? null,
          row.updated_at ?? null,
        ],
      );
    }
    return;
  }

  if (table === "app_analysis_jobs") {
    for (const raw of rows) {
      const row = raw as {
        id: string;
        user_id: string;
        document_id: string;
        history_id: string;
        file_name: string;
        status?: string;
        attempts?: number;
        last_error?: string | null;
        claimed_at?: string | null;
        claimed_by?: string | null;
        lease_expires_at?: string | null;
        started_at?: string | null;
        completed_at?: string | null;
        skip_ready_reply?: boolean;
        p1_duration_ms?: number | null;
        user_email?: string | null;
        pages?: unknown;
        metrics?: unknown;
        created_at?: string;
        updated_at?: string;
      };
      await query(
        `insert into public.app_analysis_jobs
          (id, user_id, document_id, history_id, file_name, status, attempts,
           last_error, claimed_at, claimed_by, lease_expires_at, started_at,
           completed_at, skip_ready_reply, p1_duration_ms, user_email, pages,
           metrics, created_at, updated_at)
         values (
           $1,$2,$3,$4,$5,$6,$7,$8,
           $9::timestamptz,$10,$11::timestamptz,$12::timestamptz,$13::timestamptz,
           $14,$15,$16,$17::jsonb,$18::jsonb,
           coalesce($19::timestamptz, timezone('utc', now())),
           coalesce($20::timestamptz, timezone('utc', now()))
         )
         on conflict (id) do update set
           status = excluded.status,
           attempts = excluded.attempts,
           last_error = excluded.last_error,
           metrics = excluded.metrics,
           updated_at = excluded.updated_at`,
        [
          row.id,
          row.user_id,
          row.document_id,
          row.history_id,
          row.file_name,
          row.status ?? "pending",
          row.attempts ?? 0,
          row.last_error ?? null,
          row.claimed_at ?? null,
          row.claimed_by ?? null,
          row.lease_expires_at ?? null,
          row.started_at ?? null,
          row.completed_at ?? null,
          row.skip_ready_reply !== false,
          row.p1_duration_ms ?? null,
          row.user_email ?? null,
          JSON.stringify(row.pages ?? null),
          JSON.stringify(row.metrics ?? null),
          row.created_at ?? null,
          row.updated_at ?? null,
        ],
      );
    }
  }
}

export function defaultPersistentBackupDeps(): PersistentBackupDeps {
  return {
    listDocuments: defaultListDocuments,
    getPdf: getPdfObject,
    putPdf: putPdfObject,
    exportTable: defaultExportTable,
    restoreTable: defaultRestoreTable,
    truncateTables: defaultTruncateTables,
  };
}

/**
 * Crée un backup production (PG + PDF S3 + manifeste).
 * Refuse si le backend n’est pas persistent (sauf deps de test injectées + force).
 */
export async function createPersistentBackup(options?: {
  id?: string;
  deps?: PersistentBackupDeps;
  /** Autorise l’appel hors mode persistent (tests unitaires). */
  allowNonPersistent?: boolean;
}): Promise<PersistentBackupManifest> {
  if (!options?.allowNonPersistent && !usePersistentStorage()) {
    throw new Error(
      "Backup persistent requis uniquement en DOCMIND_STORAGE=persistent. En FS utiliser createDailyBackup (dev uniquement).",
    );
  }

  const deps = options?.deps ?? defaultPersistentBackupDeps();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const id = options?.id ?? `persistent-${stamp}`;
  const root = backupRoot(id);
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(path.join(root, "postgres"), { recursive: true });
  await mkdir(path.join(root, "pdfs"), { recursive: true });

  const tables: Record<string, number> = {};
  const dump: Record<string, unknown[]> = {};
  for (const table of PERSISTENT_BACKUP_TABLES) {
    const rows = await deps.exportTable(table);
    dump[table] = rows;
    tables[table] = rows.length;
  }

  const dumpJson = JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      tables: dump,
    },
    null,
    2,
  );
  const dumpRel = "postgres/dump.json";
  const dumpAbs = path.join(root, dumpRel);
  await writeFile(dumpAbs, dumpJson, "utf8");
  const dumpSha = hashBuffer(dumpJson);
  const dumpSize = Buffer.byteLength(dumpJson, "utf8");

  const documents: PersistentDocumentEntry[] = [];
  let pdfBytes = 0;
  const listed = await deps.listDocuments();

  for (const doc of listed) {
    const userId = assertSafeUserId(doc.userId);
    const documentId = assertSafeResourceId(doc.documentId, "documentId");
    const expectedKey = pdfObjectKey(userId, documentId);
    if (doc.storageKey !== expectedKey) {
      throw new Error(
        `storage_key incohérent pour ${userId}/${documentId}: ${doc.storageKey} ≠ ${expectedKey}`,
      );
    }

    const bytes = await deps.getPdf(userId, documentId);
    const rel = `pdfs/${userId}/${documentId}.pdf`;
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
    const sha256 = hashBuffer(bytes);
    documents.push({
      userId,
      documentId,
      storageKey: expectedKey,
      relativePath: rel,
      size: bytes.byteLength,
      sha256,
      fileName: doc.fileName,
      sizeBytes: doc.sizeBytes,
    });
    pdfBytes += bytes.byteLength;
  }

  const manifest: PersistentBackupManifest = {
    kind: "persistent",
    id,
    createdAt: new Date().toISOString(),
    postgres: {
      relativePath: dumpRel,
      sha256: dumpSha,
      size: dumpSize,
      tables,
    },
    documents,
    totals: {
      documents: documents.length,
      pdfBytes,
      postgresBytes: dumpSize,
    },
  };

  await writeFile(
    path.join(root, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(BACKUPS_DIR, "latest-persistent.json"),
    JSON.stringify(
      { id, kind: "persistent", createdAt: manifest.createdAt },
      null,
      2,
    ),
    "utf8",
  );

  return manifest;
}

export async function verifyPersistentBackup(id: string): Promise<{
  ok: boolean;
  checked: number;
  errors: string[];
}> {
  const root = backupRoot(id);
  const errors: string[] = [];
  let checked = 0;

  let manifest: PersistentBackupManifest;
  try {
    manifest = JSON.parse(
      await readFile(path.join(root, "manifest.json"), "utf8"),
    ) as PersistentBackupManifest;
  } catch {
    return { ok: false, checked: 0, errors: ["manifest.json manquant ou invalide"] };
  }

  if (manifest.kind !== "persistent") {
    errors.push("manifest.kind ≠ persistent");
  }

  try {
    const dumpRel = assertSafeRelativePath(
      manifest.postgres.relativePath,
      root,
    );
    const dumpBuf = await readFile(path.join(root, dumpRel));
    const sha = hashBuffer(dumpBuf);
    checked += 1;
    if (sha !== manifest.postgres.sha256) {
      errors.push(`hash mismatch: ${dumpRel}`);
    }
    if (dumpBuf.byteLength !== manifest.postgres.size) {
      errors.push(`size mismatch: ${dumpRel}`);
    }
  } catch (error) {
    errors.push(
      `postgres dump: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  for (const doc of manifest.documents) {
    try {
      const rel = assertSafeRelativePath(doc.relativePath, root);
      assertSafePdfRelativePath(rel);
      const abs = path.join(root, rel);
      const buf = await readFile(abs);
      checked += 1;
      if (hashBuffer(buf) !== doc.sha256) {
        errors.push(`hash mismatch: ${rel}`);
      }
      if (buf.byteLength !== doc.size) {
        errors.push(`size mismatch: ${rel}`);
      }
      if (doc.storageKey !== pdfObjectKey(doc.userId, doc.documentId)) {
        errors.push(`storageKey incohérent: ${rel}`);
      }
    } catch (error) {
      errors.push(
        `${doc.relativePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { ok: errors.length === 0, checked, errors };
}

/**
 * Cohérence DB ↔ fichiers après restore (ou sur un staging vivant).
 */
export async function verifyPersistentDbFileConsistency(options?: {
  deps?: PersistentBackupDeps;
  manifest?: PersistentBackupManifest;
}): Promise<{ ok: boolean; errors: string[] }> {
  const deps = options?.deps ?? defaultPersistentBackupDeps();
  const errors: string[] = [];
  const docs = await deps.listDocuments();
  const byId = new Map<string, (typeof docs)[number]>();
  for (const d of docs) {
    byId.set(`${d.userId}/${d.documentId}`, d);
  }

  if (options?.manifest) {
    for (const entry of options.manifest.documents) {
      const key = `${entry.userId}/${entry.documentId}`;
      const row = byId.get(key);
      if (!row) {
        errors.push(`DB manquante pour PDF sauvegardé: ${key}`);
        continue;
      }
      if (row.storageKey !== entry.storageKey) {
        errors.push(`storage_key diverge: ${key}`);
      }
      try {
        const bytes = await deps.getPdf(entry.userId, entry.documentId);
        if (hashBuffer(bytes) !== entry.sha256) {
          errors.push(`PDF S3 hash diverge: ${key}`);
        }
      } catch (error) {
        errors.push(
          `PDF S3 illisible: ${key} (${error instanceof Error ? error.message : String(error)})`,
        );
      }
    }
  }

  for (const doc of docs) {
    try {
      assertSafeUserId(doc.userId);
      assertSafeResourceId(doc.documentId, "documentId");
      if (doc.storageKey !== pdfObjectKey(doc.userId, doc.documentId)) {
        errors.push(
          `storage_key ≠ pdfObjectKey: ${doc.userId}/${doc.documentId}`,
        );
      }
      await deps.getPdf(doc.userId, doc.documentId);
    } catch (error) {
      errors.push(
        `document orphelin/incohérent ${doc.userId}/${doc.documentId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

function assertStagingRestoreAllowed(options?: {
  allowProduction?: boolean;
  force?: boolean;
}): void {
  if (options?.force) return;
  const env = (
    process.env.NEXT_PUBLIC_APP_ENV ||
    process.env.NODE_ENV ||
    "development"
  ).toLowerCase();

  if (env === "staging" || env === "development" || env === "test") {
    return;
  }

  if (
    options?.allowProduction ||
    process.env.BACKUP_RESTORE_ALLOW_PRODUCTION === "1"
  ) {
    return;
  }

  throw new Error(
    "Restore persistent refusé hors staging. Utilisez NEXT_PUBLIC_APP_ENV=staging " +
      "ou BACKUP_RESTORE_ALLOW_PRODUCTION=1 (incident contrôlé uniquement).",
  );
}

/**
 * Restaure un backup persistent vers un environnement staging (ou prod autorisée).
 * Vérifie SHA-256, refuse les chemins dangereux, restaure PG puis PDF S3,
 * puis contrôle la cohérence DB ↔ fichiers.
 */
export async function restorePersistentBackup(
  id: string,
  options?: {
    dryRun?: boolean;
    deps?: PersistentBackupDeps;
    allowProduction?: boolean;
    /** Tests unitaires */
    force?: boolean;
    wipeBeforeRestore?: boolean;
  },
): Promise<{
  restoredDocuments: number;
  restoredTables: Record<string, number>;
  dryRun: boolean;
  consistencyOk: boolean;
}> {
  assertStagingRestoreAllowed(options);

  const verification = await verifyPersistentBackup(id);
  if (!verification.ok) {
    throw new Error(
      `Sauvegarde persistent invalide (${verification.errors.length} erreurs). Restauration annulée.\n` +
        verification.errors.slice(0, 10).join("\n"),
    );
  }

  const root = backupRoot(id);
  const manifest = JSON.parse(
    await readFile(path.join(root, "manifest.json"), "utf8"),
  ) as PersistentBackupManifest;

  if (manifest.kind !== "persistent") {
    throw new Error("Ce backup n’est pas un backup persistent (PG+S3).");
  }

  // Refuse path traversal avant toute écriture
  assertSafeRelativePath(manifest.postgres.relativePath, root);
  for (const doc of manifest.documents) {
    const rel = assertSafeRelativePath(doc.relativePath, root);
    assertSafePdfRelativePath(rel);
  }

  if (options?.dryRun) {
    return {
      restoredDocuments: manifest.documents.length,
      restoredTables: { ...manifest.postgres.tables },
      dryRun: true,
      consistencyOk: true,
    };
  }

  const deps = options?.deps ?? defaultPersistentBackupDeps();
  const dumpRel = assertSafeRelativePath(manifest.postgres.relativePath, root);
  const dumpRaw = await readFile(path.join(root, dumpRel), "utf8");
  if (hashBuffer(dumpRaw) !== manifest.postgres.sha256) {
    throw new Error("SHA-256 dump Postgres invalide au moment du restore.");
  }

  const dumpParsed = JSON.parse(dumpRaw) as {
    tables: Partial<Record<PersistentBackupTable, unknown[]>>;
  };

  if (options?.wipeBeforeRestore !== false && deps.truncateTables) {
    await deps.truncateTables(PERSISTENT_BACKUP_TABLES);
  }

  const restoredTables: Record<string, number> = {};
  for (const table of PERSISTENT_BACKUP_TABLES) {
    const rows = dumpParsed.tables[table] ?? [];
    await deps.restoreTable(table, rows);
    restoredTables[table] = rows.length;
  }

  let restoredDocuments = 0;
  for (const doc of manifest.documents) {
    const rel = assertSafeRelativePath(doc.relativePath, root);
    const { userId, documentId } = assertSafePdfRelativePath(rel);
    const bytes = await readFile(path.join(root, rel));
    if (hashBuffer(bytes) !== doc.sha256) {
      throw new Error(`SHA-256 PDF invalide au restore: ${rel}`);
    }
    await deps.putPdf(userId, documentId, bytes);
    restoredDocuments += 1;
  }

  const consistency = await verifyPersistentDbFileConsistency({
    deps,
    manifest,
  });
  if (!consistency.ok) {
    throw new Error(
      `Restore terminé mais cohérence DB↔fichiers échouée:\n` +
        consistency.errors.slice(0, 20).join("\n"),
    );
  }

  return {
    restoredDocuments,
    restoredTables,
    dryRun: false,
    consistencyOk: true,
  };
}
