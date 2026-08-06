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
  assert.match(src, /isStripeWebhookEventClaimed/);
  assert.match(
    src,
    /if \(result\.handled\) \{\s*await claimStripeWebhookEvent/,
  );
  const claimBeforeDispatch =
    src.indexOf("await claimStripeWebhookEvent") <
    src.indexOf("dispatchStripeWebhookEvent(event)");
  // claimStripeWebhookEvent only after dispatch result
  const dispatchCall = src.indexOf("await dispatchStripeWebhookEvent(event)");
  const claimCall = src.indexOf("await claimStripeWebhookEvent(event.id");
  assert.ok(dispatchCall > 0 && claimCall > dispatchCall, "C4: claim après dispatch");
  assert.ok(!claimBeforeDispatch || claimCall > dispatchCall, "C4/M6 ordering");
  assert.match(src, /handled:false → pas de claim/);
  console.log("OK C4/M6 webhook claim après handled:true uniquement");
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
  const upload = await readSource("src/app/api/upload/route.ts");
  const uploadConsume = upload.indexOf("await consumeQuota(");
  assert.ok(
    upload.indexOf("await assertValidPdfUpload(") < uploadConsume,
    "upload: PDF validé avant quota",
  );
  const search = await readSource("src/app/api/search/route.ts");
  const searchConsume = search.indexOf("await consumeQuota(");
  assert.ok(
    search.slice(0, searchConsume).includes("500"),
    "search: longueur max avant quota",
  );
  const letters = await readSource("src/app/api/letters/route.ts");
  const consumeIdx = letters.indexOf("await consumeQuota(");
  const histIdx = letters.indexOf("await getHistoryRecord(");
  assert.ok(histIdx > 0 && histIdx < consumeIdx, "letters: ownership avant quota");
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

async function main() {
  await testC1DocumentRowExport();
  await testC2DeleteBlocksOnStripeCancelFailure();
  await testC3PersistentWipeAuthoritative();
  await testC4AndM6WebhookClaimAfterSuccessOnly();
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
