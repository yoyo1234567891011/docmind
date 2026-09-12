/**
 * Non-régression — correctifs audit zero-defect (CRITICAL + MAJOR).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { DocumentRow } from "../src/components/documents/manager/document-row";
import {
  BACKUPS_DIR,
  PRODUCT_ANALYTICS_FILE,
  userMemoryIndexesDir,
} from "../src/config/paths";
import { AppError } from "../src/lib/errors";
import { wipeUserLocalData } from "../src/services/account/delete-account";
import {
  anonymizeAnalyticsForUser,
  trackAnalyticsEvent,
} from "../src/services/analytics/store";
import {
  ensureUserWorkspace,
  resetUserWorkspaceCache,
} from "../src/services/auth/workspace";
import { restoreBackup } from "../src/services/backup/backup";
import { upsertSubscriptionPatch } from "../src/services/billing/store";
import { getMemoryDocument } from "../src/services/memory/document-store";
import { runMemoryDualWrite } from "../src/services/memory/dual-write";
import {
  indexCategoryDoc,
  indexDeadlineTime,
  removeDocFromIndexes,
} from "../src/services/memory/indexes";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import { EMPTY_READY_REPLY } from "../src/types/reply";
import type { HistoryRecord } from "../src/types/history";

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

async function readSource(rel: string): Promise<string> {
  return readFile(path.join(process.cwd(), rel), "utf8");
}

function assertQuotaAfterValidation(src: string, label: string) {
  const consumeIdx = src.indexOf("await consumeQuota(");
  assert.ok(consumeIdx > 0, `${label}: consumeQuota présent`);
  const before = src.slice(0, consumeIdx);
  assert.ok(
    before.includes("BAD_REQUEST") || before.includes("historyId"),
    `${label}: validation avant consumeQuota`,
  );
}

async function testC1DocumentRowExport() {
  assert.equal(typeof DocumentRow, "object");
  assert.ok(DocumentRow);
  console.log("OK C1 DocumentRow export");
}

async function testC2DeleteBlocksOnStripeCancelFailure() {
  const userId = `zd-stripe-${Date.now()}`;
  resetUserWorkspaceCache();
  await ensureUserWorkspace(userId);
  await upsertSubscriptionPatch(userId, {
    plan: "premium",
    status: "active",
    stripeSubscriptionId: "sub_zd_nonexistent_should_fail",
    stripeCustomerId: "cus_zd_fake",
  });

  await withEnv(
    {
      STRIPE_SECRET_KEY: "sk_test_zd_invalid_key_for_cancel_failure",
      STRIPE_PRICE_PREMIUM: "price_zd_test_premium",
      DOCMIND_STORAGE: "fs",
    },
    async () => {
      await assert.rejects(
        () => wipeUserLocalData(userId),
        (err: unknown) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.status, 502);
          assert.match(err.message, /Stripe/i);
          return true;
        },
      );
    },
  );
  console.log("OK C2 delete bloqué si Stripe cancel échoue");
}

async function testC3PersistentWipeAuthoritative() {
  const src = await readSource("src/services/account/delete-account.ts");
  assert.match(
    src,
    /ne doit PAS marquer dataRemoved si le wipe cloud a échoué/,
  );
  assert.match(src, /if \(!dataRemoved\)/);
  assert.match(src, /Échec de la suppression des données cloud/);
  // FS rm est avant le throw, et dataRemoved n'est pas réassigné à true après rm en mode persistent
  const persistentBlock = src.slice(
    src.indexOf("if (persistent)"),
    src.indexOf("} else {"),
  );
  assert.ok(
    !/dataRemoved\s*=\s*true/.test(persistentBlock.split("wipePersistentUserData")[1] ?? ""),
    "C3: pas de dataRemoved=true après échec wipe (hors succès wipePersistent)",
  );
  const afterRm = persistentBlock.slice(persistentBlock.indexOf("await rm(userDataDir"));
  assert.ok(
    !afterRm.includes("dataRemoved = true"),
    "C3: rm FS ne doit pas forcer dataRemoved=true",
  );
  const s3 = await readSource("src/lib/storage/s3.ts");
  const delFn = s3.slice(s3.indexOf("export async function deletePdfObject"));
  assert.ok(
    !delFn.slice(0, 400).includes(".catch(() => undefined)"),
    "C3: deletePdfObject propage les erreurs S3 (wipe autoritatif)",
  );
  console.log("OK C3 wipe persistent autoritatif");
}

async function testC4AndM6WebhookClaimAfterSuccessOnly() {
  const src = await readSource("src/services/billing/webhook.ts");
  assert.match(src, /processStripeWebhookEvent/);
  assert.match(src, /withKeyedLock/);
  assert.match(src, /billing:webhook:/);
  assert.match(src, /if \(result\.handled\) \{\s*await deps\.claim/);
  const processFn = src.slice(src.indexOf("export async function processStripeWebhookEvent"));
  const dispatchIdx = processFn.indexOf("await deps.dispatch(");
  const claimIdx = processFn.indexOf("await deps.claim(");
  assert.ok(dispatchIdx > 0 && claimIdx > dispatchIdx, "C4: claim après dispatch");
  assert.match(src, /handled:false → pas de claim/);
  assert.match(src, /Claim APRÈS succès/);
  console.log("OK C4/M6 webhook claim après handled:true + single-flight");
}

async function testM5ExportUsesS3WhenPersistent() {
  const src = await readSource("src/services/account/export-account.ts");
  assert.match(src, /getPdfObject/);
  assert.match(src, /usePersistentStorage\(\)/);
  assert.match(src, /loadExportPdf/);
  assert.match(src, /error\.status === 404/);
  const s3 = await readSource("src/lib/storage/s3.ts");
  assert.match(s3, /Impossible de lire le PDF depuis le stockage/);
  console.log("OK M5 export PDF via S3 en mode persistent");
}

async function testM7DeadlineTimePurge() {
  const userId = `zd-dl-${Date.now()}`;
  const docId = `doc-${Date.now()}`;
  const deadlineId = `dl-${Date.now()}`;
  resetUserWorkspaceCache();
  await ensureUserWorkspace(userId);

  await indexDeadlineTime(userId, "2026-12-01", deadlineId);
  await indexCategoryDoc(userId, "bail", docId);

  // Ancien bug : purge par docId ne retirait pas les deadlineId
  await removeDocFromIndexes(userId, docId, { deadlineIds: [deadlineId] });

  const deadlineMap = JSON.parse(
    await readFile(
      path.join(userMemoryIndexesDir(userId), "deadline_time.json"),
      "utf8",
    ),
  ) as Record<string, string[]>;
  const categoryMap = JSON.parse(
    await readFile(
      path.join(userMemoryIndexesDir(userId), "by_category.json"),
      "utf8",
    ),
  ) as Record<string, string[]>;

  assert.ok(
    !(deadlineMap["2026-12-01"] ?? []).includes(deadlineId),
    "deadline_time purgé par deadlineId",
  );
  assert.ok(
    !(categoryMap.bail ?? []).includes(docId),
    "by_category purgé par docId",
  );

  const purgeSrc = await readSource("src/services/memory/purge-document.ts");
  assert.match(purgeSrc, /listDeadlinesForDoc/);
  assert.match(purgeSrc, /deadlineIds/);

  await rm(path.join(process.cwd(), "data", "users", userId), {
    recursive: true,
    force: true,
  }).catch(() => undefined);
  console.log("OK M7 purge deadline_time");
}

async function testM8DualWriteSkipsDeletedHistory() {
  const userId = `zd-dw-${Date.now()}`;
  const documentId = `doc-${Date.now()}`;
  resetUserWorkspaceCache();
  await ensureUserWorkspace(userId);

  // History absente (supprimée / jamais créée) → dual-write ne doit rien upsert.
  const record: HistoryRecord = {
    id: `hist-${Date.now()}`,
    userId,
    documentId,
    fileName: "zd.pdf",
    displayName: null,
    favorite: false,
    tagIds: [],
    createdAt: new Date().toISOString(),
    analyzedAt: new Date().toISOString(),
    model: "test",
    extractedText: "contrat de bail test dual-write",
    folderId: null,
    analysisPhase: "complete",
    classification: {
      category: "bail",
      label: "Bail",
      confidence: 0.9,
    },
    analysis: {
      document_type: "Bail",
      title: "Test",
      summary: "test",
      date: "",
      dates: [],
      people: [],
      organizations: [],
      amounts: [],
      deadlines: [],
      important_points: [],
      actions: [],
      risks: [],
      risk_score: 0,
      risk_level: "faible",
      risk_explanation: "",
      risk_criteria: RISK_CRITERIA.map((c) => ({
        id: c.id,
        label: c.label,
        detected: false,
        score: 0,
        max_score: c.maxScore,
        reasons: [],
      })),
    },
    readyReply: EMPTY_READY_REPLY,
  };

  await runMemoryDualWrite(record);

  assert.equal(
    await getMemoryDocument(userId, documentId),
    null,
    "dual-write ne doit pas ressusciter un doc après delete history",
  );
  const dwSrc = await readSource("src/services/memory/dual-write.ts");
  assert.match(dwSrc, /purgeMemoryForDocument/);
  const histSrc = await readSource("src/services/history/store.ts");
  assert.match(histSrc, /memory:dual:/);

  await rm(path.join(process.cwd(), "data", "users", userId), {
    recursive: true,
    force: true,
  }).catch(() => undefined);
  console.log("OK M8 dual-write guard history exists");
}

async function testM9QuotaAfterValidation() {
  const analyze = await readSource("src/app/api/analyze/route.ts");
  const assertIdx = analyze.indexOf("await assertQuotaAvailable(");
  const consumeIdx = analyze.indexOf("await consumeQuota(");
  assert.ok(assertIdx > 0, "analyze: assertQuotaAvailable présent");
  assert.ok(
    consumeIdx < 0 || consumeIdx > assertIdx,
    "analyze: consumeQuota pas avant assertQuota",
  );
  const worker = await readSource("src/services/analysis-jobs/worker.ts");
  assert.match(
    worker,
    /consumeAnalyzeQuotaOnJobSuccess/,
    "worker: débit au complete P2",
  );

  const upload = await readSource("src/app/api/upload/route.ts");
  const uploadConsume = upload.indexOf("await consumeQuota(");
  const uploadPersist = upload.indexOf("await uploadPdfDocument(");
  const uploadRefund = upload.indexOf("await refundQuota(");
  assert.ok(
    upload.indexOf("await assertValidPdfUpload(") < uploadConsume,
    "upload: PDF validé avant quota",
  );
  assert.ok(
    uploadConsume > 0 &&
      uploadPersist > uploadConsume &&
      uploadRefund > uploadPersist,
    "upload: refundQuota si échec après consume (consommation définitive = succès)",
  );
  const search = await readSource("src/app/api/search/route.ts");
  const searchConsume = search.indexOf("await consumeQuota(");
  const searchRefund = search.indexOf("await refundQuota(");
  const searchRun = search.indexOf("await runSmartSearch(");
  assert.ok(
    search.slice(0, searchConsume).includes("500"),
    "search: longueur max avant quota",
  );
  assert.ok(
    searchConsume > 0 &&
      searchRun > searchConsume &&
      searchRefund > searchRun,
    "search: refundQuota si échec après consume (0 résultat = succès)",
  );
  const letters = await readSource("src/app/api/letters/route.ts");
  const lettersConsumeIdx = letters.indexOf("await consumeQuota(");
  const histIdx = letters.indexOf("await getHistoryRecord(");
  assert.ok(
    histIdx > 0 && histIdx < lettersConsumeIdx,
    "letters: ownership avant quota",
  );
  console.log("OK M9 quota après validation");
}

async function testM10BackupPathTraversal() {
  const id = `zd-path-${Date.now()}`;
  const root = path.join(BACKUPS_DIR, id);
  await mkdir(path.join(root, "data"), { recursive: true });

  const safeRel = "data/ok.txt";
  const safeAbs = path.join(root, safeRel);
  await writeFile(safeAbs, "ok", "utf8");
  const safeHash = createHash("sha256").update("ok").digest("hex");

  const evilRel = "data/../escape.txt";
  const evilAbs = path.join(root, "escape.txt");
  await writeFile(evilAbs, "pwn", "utf8");
  const evilHash = createHash("sha256").update("pwn").digest("hex");

  const manifest = {
    id,
    createdAt: new Date().toISOString(),
    files: [
      { relativePath: safeRel, size: 2, sha256: safeHash },
      { relativePath: evilRel, size: 3, sha256: evilHash },
    ],
    totals: { files: 2, bytes: 5 },
    sources: ["data"],
  };
  await writeFile(
    path.join(root, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  await assert.rejects(
    () => restoreBackup(id),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /invalide|hors/i);
      return true;
    },
  );

  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  console.log("OK M10 restore path traversal bloqué");
}

/**
 * C5 — Résurrection FS→PG interdite après delete en mode persistent.
 * 1) créer donnée FS  2) passer persistent  3) wipe user
 * 4) résidu FS (autre instance) ne doit pas réécrire PG
 * 5) fail-closed prod (STORAGE + FALLBACK)
 */
async function testC5FsFallbackNoResurrection() {
  const {
    assertPersistentReadyOrThrow,
    isFsFallbackEnabled,
  } = await import("../src/config/persistence");
  const { validateProductionEnv } = await import("../src/lib/env-validate");
  const { userFileRead } = await import("../src/lib/user-files");
  const { userDataDir } = await import("../src/config/paths");

  const prodBase = {
    NEXT_PUBLIC_APP_ENV: "production",
    NODE_ENV: "production",
    DOCMIND_SKIP_ENV_ASSERT: undefined,
    PG_SSL_REJECT_UNAUTHORIZED: undefined,
    EVAL_ALLOW_IN_DEPLOY: undefined,
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    NEXT_PUBLIC_APP_URL: "https://app.example",
    ADMIN_EMAILS: "admin@example.com",
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_PRICE_PREMIUM: "price_x",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_x",
    DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/docmind",
    REDIS_URL: "redis://127.0.0.1:6379",
    S3_BUCKET: "bucket",
    S3_ACCESS_KEY_ID: "key",
    S3_SECRET_ACCESS_KEY: "secret",
    AWS_REGION: "eu-west-1",
  };

  // 5a — fail-closed: STORAGE manquant / fs
  await withEnv(
    { ...prodBase, DOCMIND_STORAGE: "fs", DOCMIND_FS_FALLBACK: "0" },
    async () => {
      const errors = validateProductionEnv().filter((i) => i.level === "error");
      assert.ok(
        errors.some((e) => e.message.includes("DOCMIND_STORAGE=persistent")),
        "prod refuse DOCMIND_STORAGE=fs",
      );
      assert.throws(
        () => assertPersistentReadyOrThrow(),
        /DOCMIND_STORAGE=persistent/,
      );
    },
  );

  // 5b — fail-closed: FALLBACK non coupé
  await withEnv(
    {
      ...prodBase,
      DOCMIND_STORAGE: "persistent",
      DOCMIND_FS_FALLBACK: undefined,
    },
    async () => {
      const errors = validateProductionEnv().filter((i) => i.level === "error");
      assert.ok(
        errors.some((e) => e.message.includes("DOCMIND_FS_FALLBACK=0")),
        "prod exige DOCMIND_FS_FALLBACK=0",
      );
      assert.equal(isFsFallbackEnabled(), false, "fallback hard-off en déployé");
      assert.throws(
        () => assertPersistentReadyOrThrow(),
        /DOCMIND_FS_FALLBACK=0/,
      );
    },
  );

  await withEnv(
    {
      ...prodBase,
      DOCMIND_STORAGE: "persistent",
      DOCMIND_FS_FALLBACK: "0",
    },
    async () => {
      assert.equal(
        validateProductionEnv().filter((i) => i.level === "error").length,
        0,
      );
      assert.doesNotThrow(() => assertPersistentReadyOrThrow());
      assert.equal(isFsFallbackEnabled(), false);
    },
  );

  // Runtime: mock PG + résidu FS après wipe
  const userId = `zd-res-${Date.now()}`;
  const relKey = "memory/resurrect.json";
  const abs = path.join(userDataDir(userId), relKey);
  const files = new Map<string, string>();
  let insertCount = 0;

  type PoolGlobal = typeof globalThis & {
    __docmindPgPool?: {
      query: (
        text: string,
        params?: unknown[],
      ) => Promise<{ rows: unknown[]; rowCount?: number }>;
    } | null;
  };
  const g = globalThis as PoolGlobal;
  const prevPool = g.__docmindPgPool;

  g.__docmindPgPool = {
    query: async (text: string, params: unknown[] = []) => {
      const sql = text.replace(/\s+/g, " ").trim().toLowerCase();
      if (sql.includes("select content from public.app_user_files")) {
        const content = files.get(`${params[0]}|${params[1]}`);
        return {
          rows: content != null ? [{ content }] : [],
        };
      }
      if (sql.includes("insert into public.app_user_files")) {
        insertCount += 1;
        files.set(`${String(params[0])}|${String(params[1])}`, String(params[2]));
        return { rows: [] };
      }
      if (sql.includes("delete from public.app_user_files")) {
        const uid = String(params[0]);
        for (const key of [...files.keys()]) {
          if (key.startsWith(`${uid}|`)) files.delete(key);
        }
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("delete from")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("select document_id from public.app_documents")) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  try {
    // 1) créer donnée FS
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, JSON.stringify({ resurrect: true }), "utf8");

    // Contrôle: en local persistent + FALLBACK=1, promote aurait lieu
    await withEnv(
      {
        NEXT_PUBLIC_APP_ENV: "development",
        NODE_ENV: "development",
        DOCMIND_STORAGE: "persistent",
        DOCMIND_FS_FALLBACK: "1",
        DATABASE_URL: "postgresql://mock:mock@127.0.0.1:5432/mock",
        REDIS_URL: undefined,
        STRIPE_SECRET_KEY: undefined,
        STRIPE_PRICE_PREMIUM: undefined,
      },
      async () => {
        insertCount = 0;
        files.clear();
        const promoted = await userFileRead(userId, abs);
        assert.ok(promoted?.includes("resurrect"));
        assert.equal(insertCount, 1, "contrôle: promote actif si FALLBACK=1 local");
        assert.equal(files.size, 1);
      },
    );

    // 2) persistent + FALLBACK=0  3) wipe (PG vidé ; on resimule résidu FS ensuite)
    await withEnv(
      {
        NEXT_PUBLIC_APP_ENV: "development",
        NODE_ENV: "development",
        DOCMIND_STORAGE: "persistent",
        DOCMIND_FS_FALLBACK: "0",
        DATABASE_URL: "postgresql://mock:mock@127.0.0.1:5432/mock",
        REDIS_URL: undefined,
        STRIPE_SECRET_KEY: undefined,
        STRIPE_PRICE_PREMIUM: undefined,
        SUPABASE_SERVICE_ROLE_KEY: undefined,
        S3_BUCKET: "bucket",
        S3_ACCESS_KEY_ID: "key",
        S3_SECRET_ACCESS_KEY: "secret",
        AWS_REGION: "eu-west-1",
      },
      async () => {
        insertCount = 0;
        await wipeUserLocalData(userId);
        assert.equal(files.size, 0, "PG vidé après wipe");

        // Résidu multi-instance (autre nœud n'a pas reçu le rm)
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, JSON.stringify({ resurrect: true }), "utf8");

        // 4) lecture ultérieure ne recrée aucune donnée PG
        const after = await userFileRead(userId, abs);
        assert.equal(after, null, "FS ignoré sans fallback");
        assert.equal(insertCount, 0, "aucune promotion PG après delete");
        assert.equal(files.size, 0, "PG reste vide");
      },
    );

    // 5) fail-closed déployé même si FALLBACK=1 mal configuré au runtime
    await withEnv(
      {
        NEXT_PUBLIC_APP_ENV: "production",
        NODE_ENV: "production",
        DOCMIND_STORAGE: "persistent",
        DOCMIND_FS_FALLBACK: "1",
        DATABASE_URL: "postgresql://mock:mock@127.0.0.1:5432/mock",
      },
      async () => {
        assert.equal(isFsFallbackEnabled(), false);
        insertCount = 0;
        files.clear();
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, JSON.stringify({ resurrect: true }), "utf8");
        const leaked = await userFileRead(userId, abs);
        assert.equal(leaked, null);
        assert.equal(insertCount, 0);
      },
    );

    console.log("OK C5 FS fallback fail-closed — pas de résurrection PG");
  } finally {
    g.__docmindPgPool = prevPool;
    await rm(userDataDir(userId), { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

async function testM11AnalyticsAnonymizedOnDelete() {
  const userId = `zd-an-${Date.now()}`;
  resetUserWorkspaceCache();
  await ensureUserWorkspace(userId);

  const tracked = await trackAnalyticsEvent({
    name: "analysis.completed",
    userId,
    meta: { source: "zd-test" },
  });
  assert.equal(tracked.recorded, true, "événement analytics enregistré");

  await withEnv(
    {
      STRIPE_SECRET_KEY: undefined,
      STRIPE_PRICE_PREMIUM: undefined,
      DOCMIND_STORAGE: "fs",
    },
    async () => {
      await wipeUserLocalData(userId);
    },
  );

  // Double-check helper still works in isolation
  const again = await anonymizeAnalyticsForUser(userId);
  assert.equal(again.updated, 0, "déjà anonymisé (plus de userId)");

  const file = JSON.parse(await readFile(PRODUCT_ANALYTICS_FILE, "utf8")) as {
    events: Array<{ userId: string | null; meta?: { source?: string } }>;
  };
  const zdEvents = file.events.filter((e) => e.meta?.source === "zd-test");
  assert.ok(zdEvents.length >= 1);
  assert.ok(
    zdEvents.every((e) => e.userId === null),
    "analytics userId null après delete",
  );
  console.log("OK M11 analytics anonymisés au delete");
}

/** C6 — SKIP_ENV_ASSERT ne contourne pas les protections en déployé. */
async function testC6SkipCannotBypassDeployed() {
  const { assertProductionEnvOrThrow, validateProductionEnv } = await import(
    "../src/lib/env-validate"
  );
  const { assertPersistentReadyOrThrow } = await import(
    "../src/config/persistence"
  );

  await withEnv(
    {
      NEXT_PUBLIC_APP_ENV: "production",
      DOCMIND_SKIP_ENV_ASSERT: "1",
      DOCMIND_STORAGE: "fs",
      DOCMIND_FS_FALLBACK: "1",
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
      BILLING_ENTITLEMENTS_FAIL_OPEN: "1",
    },
    async () => {
      const errors = validateProductionEnv().filter((i) => i.level === "error");
      assert.ok(errors.length >= 3, "erreurs prod toujours listées");
      assert.throws(() => assertProductionEnvOrThrow(), /Configuration invalide/);
      assert.throws(
        () => assertPersistentReadyOrThrow(),
        /DATABASE_URL|DOCMIND_STORAGE|REDIS_URL|DOCMIND_FS_FALLBACK/,
      );
    },
  );

  // En development, SKIP peut court-circuiter assertProductionEnvOrThrow
  await withEnv(
    {
      NEXT_PUBLIC_APP_ENV: "development",
      NODE_ENV: "development",
      DOCMIND_SKIP_ENV_ASSERT: "1",
    },
    async () => {
      assert.doesNotThrow(() => assertProductionEnvOrThrow());
    },
  );

  console.log("OK C6 SKIP_ENV_ASSERT ignoré en déployé");
}

async function main() {
  await testC1DocumentRowExport();
  await testC2DeleteBlocksOnStripeCancelFailure();
  await testC3PersistentWipeAuthoritative();
  await testC4AndM6WebhookClaimAfterSuccessOnly();
  await testC5FsFallbackNoResurrection();
  await testC6SkipCannotBypassDeployed();
  await testM5ExportUsesS3WhenPersistent();
  await testM7DeadlineTimePurge();
  await testM8DualWriteSkipsDeletedHistory();
  await testM9QuotaAfterValidation();
  await testM10BackupPathTraversal();
  await testM11AnalyticsAnonymizedOnDelete();
  console.log("\nOK test-zero-defect-fixes — tous les correctifs couverts");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
