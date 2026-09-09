/**
 * Transaction logique upload S3 ↔ PostgreSQL.
 *
 * Scénarios d’échec :
 * 1) S3 échoue → aucun upsert PG, aucun delete, aucun cleanup
 * 2) S3 OK + PG échoue → delete S3 immédiat
 * 3) S3 OK + PG échoue + delete échoue → job de nettoyage traçable
 *
 * + quota non consommé tant que l’upload n’a pas réussi (contrat route).
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { AppError } from "../src/lib/errors";
import { persistPdfToS3AndPostgres } from "../src/services/storage/persist-pdf";
import type { StorageCleanupJob } from "../src/services/storage/cleanup-jobs";

async function scenarioS3FailsNoPg() {
  let upsertCalls = 0;
  let deleteCalls = 0;
  let cleanupCalls = 0;

  await assert.rejects(
    () =>
      persistPdfToS3AndPostgres(
        {
          userId: "u1",
          documentId: "doc-s3-fail",
          bytes: Buffer.from("%PDF-1.4 fail"),
        },
        {
          putObject: async () => {
            throw new Error("S3 down");
          },
          upsertMeta: async () => {
            upsertCalls += 1;
          },
          deleteObject: async () => {
            deleteCalls += 1;
          },
          enqueueCleanup: async () => {
            cleanupCalls += 1;
            throw new Error("should not enqueue");
          },
        },
      ),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "UPLOAD_FAILED");
      return true;
    },
  );

  assert.equal(upsertCalls, 0, "aucun document PG si S3 échoue");
  assert.equal(deleteCalls, 0, "pas de delete si S3 n’a pas écrit");
  assert.equal(cleanupCalls, 0, "pas de cleanup job");
  console.log("OK 1) S3 fail → pas de PG");
}

async function scenarioPgFailsDeletesS3() {
  let putCalls = 0;
  let upsertCalls = 0;
  let deleteCalls = 0;
  let cleanupCalls = 0;

  await assert.rejects(
    () =>
      persistPdfToS3AndPostgres(
        {
          userId: "u1",
          documentId: "doc-pg-fail",
          bytes: Buffer.from("%PDF-1.4 ok"),
        },
        {
          putObject: async () => {
            putCalls += 1;
            return { key: "users/u1/doc-pg-fail.pdf" };
          },
          upsertMeta: async () => {
            upsertCalls += 1;
            throw new Error("PG down");
          },
          deleteObject: async () => {
            deleteCalls += 1;
          },
          enqueueCleanup: async () => {
            cleanupCalls += 1;
            throw new Error("should not enqueue when delete works");
          },
        },
      ),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "UPLOAD_FAILED");
      return true;
    },
  );

  assert.equal(putCalls, 1);
  assert.equal(upsertCalls, 1);
  assert.equal(deleteCalls, 1, "compensation S3 immédiate");
  assert.equal(cleanupCalls, 0);
  console.log("OK 2) PG fail → delete S3");
}

async function scenarioDeleteFailsEnqueuesCleanup() {
  let deleteCalls = 0;
  const jobs: StorageCleanupJob[] = [];

  await assert.rejects(
    () =>
      persistPdfToS3AndPostgres(
        {
          userId: "u1",
          documentId: "doc-orphan",
          bytes: Buffer.from("%PDF-1.4 orphan"),
        },
        {
          putObject: async () => ({ key: "users/u1/doc-orphan.pdf" }),
          upsertMeta: async () => {
            throw new Error("PG down");
          },
          deleteObject: async () => {
            deleteCalls += 1;
            throw new Error("S3 delete denied");
          },
          enqueueCleanup: async (input) => {
            const job: StorageCleanupJob = {
              id: "cleanup-1",
              kind: input.kind,
              userId: input.userId,
              documentId: input.documentId,
              storageKey: input.storageKey,
              reason: input.reason,
              attempts: 0,
              status: "pending",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastError: input.lastError,
            };
            jobs.push(job);
            return job;
          },
        },
      ),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.match(err.message, /file de nettoyage cleanup-1/);
      return true;
    },
  );

  assert.equal(deleteCalls, 1);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.kind, "s3_orphan_delete");
  assert.equal(jobs[0]?.status, "pending");
  assert.equal(jobs[0]?.documentId, "doc-orphan");
  assert.equal(jobs[0]?.reason, "pg_upsert_failed_after_s3_put");
  assert.match(jobs[0]?.lastError ?? "", /S3 delete denied/);
  console.log("OK 3) delete fail → cleanup job traçable");
}

async function scenarioSuccessNoCleanup() {
  let deleteCalls = 0;
  const result = await persistPdfToS3AndPostgres(
    {
      userId: "u1",
      documentId: "doc-ok",
      bytes: Buffer.from("%PDF-1.4 success"),
    },
    {
      putObject: async () => ({ key: "users/u1/doc-ok.pdf" }),
      upsertMeta: async () => undefined,
      deleteObject: async () => {
        deleteCalls += 1;
      },
      enqueueCleanup: async () => {
        throw new Error("no cleanup on success");
      },
    },
  );
  assert.equal(result.storageKey, "users/u1/doc-ok.pdf");
  assert.equal(deleteCalls, 0);
  console.log("OK 0) S3+PG succès");
}

async function assertQuotaContract() {
  const upload = await readFile(
    path.join(process.cwd(), "src/app/api/upload/route.ts"),
    "utf8",
  );
  const consumeIdx = upload.indexOf("await consumeQuota(");
  const persistIdx = upload.indexOf("await uploadPdfDocument(");
  const refundIdx = upload.indexOf("await refundQuota(");
  assert.ok(
    consumeIdx > 0 && persistIdx > consumeIdx && refundIdx > persistIdx,
    "quota réservé puis remboursé si échec",
  );
  const enforce = await readFile(
    path.join(process.cwd(), "src/services/quotas/enforce.ts"),
    "utf8",
  );
  assert.match(enforce, /export async function refundQuota/);
  console.log("OK quota: refund sur échec (consommation définitive = succès)");
}

async function main() {
  await scenarioSuccessNoCleanup();
  await scenarioS3FailsNoPg();
  await scenarioPgFailsDeletesS3();
  await scenarioDeleteFailsEnqueuesCleanup();
  await assertQuotaContract();
  console.log("\nOK test-upload-s3-pg-transaction — 3 échecs + succès + quota");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
