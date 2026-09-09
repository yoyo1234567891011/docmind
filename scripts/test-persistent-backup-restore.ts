/**
 * Restore d’un document complet DB + PDF (backup persistent).
 * Prouve : SHA-256, chemins dangereux refusés, cohérence DB↔PDF, staging.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { BACKUPS_DIR } from "../src/config/paths";
import {
  createPersistentBackup,
  restorePersistentBackup,
  verifyPersistentBackup,
  type PersistentBackupDeps,
  type PersistentBackupTable,
} from "../src/services/backup/persistent-backup";

async function withEnv(
  env: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function createMemoryDeps(seed: {
  userId: string;
  documentId: string;
  pdf: Buffer;
  historyId: string;
}): {
  deps: PersistentBackupDeps;
  state: {
    documents: Array<{
      userId: string;
      documentId: string;
      storageKey: string;
      fileName?: string | null;
      sizeBytes?: number | null;
    }>;
    pdfs: Map<string, Buffer>;
    tables: Record<string, unknown[]>;
  };
} {
  const storageKey = `users/${seed.userId}/${seed.documentId}.pdf`;
  type DocRow = {
    userId: string;
    documentId: string;
    storageKey: string;
    fileName?: string | null;
    sizeBytes?: number | null;
  };
  const state = {
    documents: [
      {
        userId: seed.userId,
        documentId: seed.documentId,
        storageKey,
        fileName: "contrat.pdf",
        sizeBytes: seed.pdf.byteLength,
      },
    ] as DocRow[],
    pdfs: new Map<string, Buffer>([
      [`${seed.userId}/${seed.documentId}`, Buffer.from(seed.pdf)],
    ]),
    tables: {
      app_subscriptions: [],
      app_usage: [],
      app_history: [
        {
          id: seed.historyId,
          user_id: seed.userId,
          document_id: seed.documentId,
          data: {
            id: seed.historyId,
            documentId: seed.documentId,
            fileName: "contrat.pdf",
            analysis: { document_type: "bail" },
          },
          updated_at: new Date().toISOString(),
        },
      ],
      app_documents: [
        {
          document_id: seed.documentId,
          user_id: seed.userId,
          storage_key: storageKey,
          file_name: "contrat.pdf",
          size_bytes: seed.pdf.byteLength,
          created_at: new Date().toISOString(),
        },
      ],
      app_user_blobs: [],
      app_user_files: [
        {
          user_id: seed.userId,
          path: "memory/note.json",
          content: JSON.stringify({ doc: seed.documentId }),
          updated_at: new Date().toISOString(),
        },
      ],
      stripe_webhook_events: [],
      app_storage_cleanup_jobs: [],
    } as Record<string, unknown[]>,
  };

  const deps: PersistentBackupDeps = {
    listDocuments: async () => [...state.documents],
    getPdf: async (userId, documentId) => {
      const buf = state.pdfs.get(`${userId}/${documentId}`);
      if (!buf) throw new Error("PDF missing");
      return Buffer.from(buf);
    },
    putPdf: async (userId, documentId, bytes) => {
      const key = `users/${userId}/${documentId}.pdf`;
      state.pdfs.set(`${userId}/${documentId}`, Buffer.from(bytes));
      const existing = state.documents.find(
        (d) => d.userId === userId && d.documentId === documentId,
      );
      if (!existing) {
        state.documents.push({
          userId,
          documentId,
          storageKey: key,
          sizeBytes: bytes.byteLength,
        });
      }
      return { key };
    },
    exportTable: async (table) => [...(state.tables[table] ?? [])],
    restoreTable: async (table, rows) => {
      state.tables[table] = [...rows];
      if (table === "app_documents") {
        state.documents = rows.map((raw) => {
          const row = raw as {
            user_id: string;
            document_id: string;
            storage_key: string;
            file_name?: string | null;
            size_bytes?: number | null;
          };
          return {
            userId: row.user_id,
            documentId: row.document_id,
            storageKey: row.storage_key,
            fileName: row.file_name,
            sizeBytes: row.size_bytes,
          };
        });
      }
    },
    truncateTables: async (tables: readonly PersistentBackupTable[]) => {
      for (const table of tables) state.tables[table] = [];
      state.documents = [];
      state.pdfs.clear();
    },
  };

  return { deps, state };
}

async function testFullDocumentBackupRestore() {
  const userId = "user-backup-1";
  const documentId = "doc-backup-1";
  const historyId = "hist-backup-1";
  const pdf = Buffer.from(
    `%PDF-1.4\n%docmind-persistent-backup-test\n${documentId}\n`,
  );
  const backupId = `test-persistent-${Date.now()}`;

  const { deps, state } = createMemoryDeps({
    userId,
    documentId,
    pdf,
    historyId,
  });

  const manifest = await createPersistentBackup({
    id: backupId,
    deps,
    allowNonPersistent: true,
  });

  assert.equal(manifest.kind, "persistent");
  assert.equal(manifest.totals.documents, 1);
  assert.equal(manifest.postgres.tables.app_documents, 1);
  assert.equal(manifest.postgres.tables.app_history, 1);
  assert.equal(manifest.documents[0]?.documentId, documentId);

  const verified = await verifyPersistentBackup(backupId);
  assert.equal(verified.ok, true, verified.errors.join("; "));

  // Wipe runtime state then restore into staging
  state.documents = [];
  state.pdfs.clear();
  for (const key of Object.keys(state.tables)) state.tables[key] = [];

  await withEnv({ NEXT_PUBLIC_APP_ENV: "staging" }, async () => {
    const restored = await restorePersistentBackup(backupId, {
      deps,
      wipeBeforeRestore: true,
    });
    assert.equal(restored.dryRun, false);
    assert.equal(restored.consistencyOk, true);
    assert.equal(restored.restoredDocuments, 1);
    assert.equal(restored.restoredTables.app_documents, 1);
    assert.equal(restored.restoredTables.app_history, 1);
  });

  assert.equal(state.documents.length, 1);
  assert.ok(state.pdfs.has(`${userId}/${documentId}`));
  assert.deepEqual(
    state.pdfs.get(`${userId}/${documentId}`),
    pdf,
  );
  assert.equal(
    (state.tables.app_history[0] as { document_id: string }).document_id,
    documentId,
  );
  assert.equal(
    (state.tables.app_user_files[0] as { path: string }).path,
    "memory/note.json",
  );

  await rm(path.join(BACKUPS_DIR, backupId), {
    recursive: true,
    force: true,
  }).catch(() => undefined);

  console.log("OK restore document complet DB + PDF");
}

async function testRefuseDangerousPath() {
  const backupId = `test-persistent-evil-${Date.now()}`;
  const root = path.join(BACKUPS_DIR, backupId);
  await mkdir(path.join(root, "postgres"), { recursive: true });
  await mkdir(path.join(root, "pdfs"), { recursive: true });

  const dump = JSON.stringify({ version: 1, tables: {} });
  await writeFile(path.join(root, "postgres", "dump.json"), dump, "utf8");

  const { createHash } = await import("node:crypto");
  const sha = createHash("sha256").update(dump).digest("hex");

  await writeFile(
    path.join(root, "manifest.json"),
    JSON.stringify({
      kind: "persistent",
      id: backupId,
      createdAt: new Date().toISOString(),
      postgres: {
        relativePath: "postgres/dump.json",
        sha256: sha,
        size: Buffer.byteLength(dump),
        tables: {},
      },
      documents: [
        {
          userId: "u1",
          documentId: "d1",
          storageKey: "users/u1/d1.pdf",
          relativePath: "pdfs/../escape.pdf",
          size: 3,
          sha256: createHash("sha256").update("x").digest("hex"),
        },
      ],
      totals: { documents: 1, pdfBytes: 3, postgresBytes: Buffer.byteLength(dump) },
    }),
    "utf8",
  );

  const verified = await verifyPersistentBackup(backupId);
  assert.equal(verified.ok, false);
  assert.ok(
    verified.errors.some((e) => /invalide|hors backup|PDF/i.test(e)),
    verified.errors.join("; "),
  );

  await withEnv({ NEXT_PUBLIC_APP_ENV: "staging" }, async () => {
    await assert.rejects(
      () =>
        restorePersistentBackup(backupId, {
          force: true,
          deps: createMemoryDeps({
            userId: "u1",
            documentId: "d1",
            pdf: Buffer.from("x"),
            historyId: "h1",
          }).deps,
        }),
      /invalide|Sauvegarde persistent invalide/i,
    );
  });

  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  console.log("OK chemins dangereux refusés");
}

async function testRefuseProductionWithoutFlag() {
  const userId = "user-prod-1";
  const documentId = "doc-prod-1";
  const pdf = Buffer.from("%PDF-1.4 prod-guard\n");
  const backupId = `test-persistent-prod-${Date.now()}`;
  const { deps } = createMemoryDeps({
    userId,
    documentId,
    pdf,
    historyId: "hist-prod",
  });

  await createPersistentBackup({
    id: backupId,
    deps,
    allowNonPersistent: true,
  });

  await withEnv(
    {
      NEXT_PUBLIC_APP_ENV: "production",
      BACKUP_RESTORE_ALLOW_PRODUCTION: undefined,
    },
    async () => {
      await assert.rejects(
        () => restorePersistentBackup(backupId, { deps }),
        /staging|BACKUP_RESTORE_ALLOW_PRODUCTION/,
      );
    },
  );

  await rm(path.join(BACKUPS_DIR, backupId), {
    recursive: true,
    force: true,
  }).catch(() => undefined);
  console.log("OK restore prod refusé sans flag");
}

async function testSha256TamperDetected() {
  const userId = "user-tamper";
  const documentId = "doc-tamper";
  const pdf = Buffer.from("%PDF-1.4 tamper-me\n");
  const backupId = `test-persistent-tamper-${Date.now()}`;
  const { deps } = createMemoryDeps({
    userId,
    documentId,
    pdf,
    historyId: "hist-tamper",
  });

  await createPersistentBackup({
    id: backupId,
    deps,
    allowNonPersistent: true,
  });

  const pdfPath = path.join(
    BACKUPS_DIR,
    backupId,
    "pdfs",
    userId,
    `${documentId}.pdf`,
  );
  await writeFile(pdfPath, Buffer.from("%PDF-1.4 TAMPERED\n"));

  const verified = await verifyPersistentBackup(backupId);
  assert.equal(verified.ok, false);
  assert.ok(verified.errors.some((e) => e.includes("hash mismatch")));

  await rm(path.join(BACKUPS_DIR, backupId), {
    recursive: true,
    force: true,
  }).catch(() => undefined);
  console.log("OK SHA-256 détecte altération PDF");
}

async function assertDocsMentionPersistent() {
  const doc = await readFile(
    path.join(process.cwd(), "docs/10-sauvegardes-restore.md"),
    "utf8",
  );
  assert.match(doc, /Postgres \+ PDF S3|backup PG\+S3|kind: "persistent"/i);
  assert.match(doc, /BACKUP_RESTORE_ALLOW_PRODUCTION/);
  assert.match(doc, /staging/i);
  assert.ok(
    /n['’]est PAS un backup production|PAS un backup production/i.test(doc),
    "doc doit disqualifier le backup FS en production",
  );
  console.log("OK documentation procédure persistent");
}

async function main() {
  await mkdir(BACKUPS_DIR, { recursive: true });
  await testFullDocumentBackupRestore();
  await testRefuseDangerousPath();
  await testRefuseProductionWithoutFlag();
  await testSha256TamperDetected();
  await assertDocsMentionPersistent();
  console.log("\nOK test-persistent-backup-restore");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
