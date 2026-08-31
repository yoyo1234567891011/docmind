/**
 * Quota analyze : débit uniquement au succès P2 (pas au start, pas si échec final).
 * npx tsx --tsconfig tsconfig.json scripts/test-analyze-quota-on-success.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

process.env.DOCMIND_STORAGE = "fs";
process.env.DOCMIND_FS_FALLBACK = "0";
process.env.BILLING_ENTITLEMENTS_FAIL_OPEN = "1";
delete process.env.DATABASE_URL;

function withEnv(
  env: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

async function readSource(rel: string): Promise<string> {
  return readFile(join(process.cwd(), rel), "utf8");
}

async function testRouteContract() {
  const src = await readSource("src/app/api/analyze/route.ts");
  const assertIdx = src.indexOf("await assertQuotaAvailable(");
  const pagesIdx = src.indexOf("MAX_ANALYZE_PAGES");
  const scanIdx = src.indexOf("likely_scan");
  assert.ok(pagesIdx > 0 && pagesIdx < assertIdx, "pages > 30 avant quota");
  assert.ok(scanIdx > 0 && scanIdx < assertIdx, "scan avant quota");
  const fullBlock = src.slice(src.indexOf("const fullStarted"), src.length);
  const fullConsumeIdx = fullBlock.indexOf("await consumeQuota(");
  const fullAssertIdx = fullBlock.indexOf("await assertQuotaAvailable(");
  assert.ok(
    fullConsumeIdx > fullAssertIdx,
    "full mode: consumeQuota uniquement après assert + succès P2 sync",
  );
  assert.ok(
    fullBlock.includes("coalescedFromInFlight"),
    "full mode: pas de double débit single-flight",
  );
  const progressiveBlock = src.slice(
    src.indexOf("if (progressive)"),
    src.indexOf("const fullStarted"),
  );
  assert.ok(
    progressiveBlock.includes("await consumeQuota("),
    "progressive: consumeQuota à l'enqueue (leader single-flight)",
  );
  assert.ok(
    progressiveBlock.includes("markAnalysisJobQuotaPrepaid"),
    "progressive: marque quota prépayé sur le job",
  );
  assert.ok(
    progressiveBlock.includes("refundQuota"),
    "progressive: rembourse si enqueue échoue",
  );
  console.log("OK 1) refus pages/scan avant quota (pas de débit)");
}

async function testWorkerQuotaIntegration() {
  await withEnv(
    {
      DOCMIND_STORAGE: "fs",
      DOCMIND_FS_FALLBACK: "0",
      BILLING_ENTITLEMENTS_FAIL_OPEN: "1",
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
      NEXT_PUBLIC_APP_ENV: "development",
      NODE_ENV: "development",
      VERCEL: undefined,
      VERCEL_ENV: undefined,
    },
    async () => {
  const { ensureUserWorkspace } = await import(
    "../src/services/auth/workspace"
  );
  const {
    __resetAnalysisJobsFsForTests,
    enqueueAnalysisJob,
    failAnalysisJob,
    getAnalysisJob,
    processOneAnalysisJob,
    __resetP2ConcurrencyForTests,
  } = await import("../src/services/analysis-jobs");
  const { getQuotaStatus } = await import("../src/services/quotas/enforce");
  const { getPlanQuotas } = await import("../src/config/quotas");

  const userId = `quota-analyze-${Date.now()}`;
  await ensureUserWorkspace(userId);
  const freeLimit = getPlanQuotas("free").analyze;

  async function resetJobs() {
    await __resetAnalysisJobsFsForTests();
    __resetP2ConcurrencyForTests();
  }

  const usedBefore = (await getQuotaStatus(userId)).items.find(
    (i) => i.metric === "analyze",
  )!.used;

  await resetJobs();
  {
    const job = await enqueueAnalysisJob({
      userId,
      documentId: "d-fail",
      historyId: "h-fail",
      fileName: "a.pdf",
    });
    await processOneAnalysisJob({
      runP2: async () => {
        throw new Error("boom-p2-final");
      },
      fail: async (id, msg) => {
        await failAnalysisJob(id, msg);
      },
      complete: async () => {
        throw new Error("should not complete");
      },
    });
    const done = await getAnalysisJob(job.id);
    assert.equal(done!.status, "failed");
    const usedAfterFail = (await getQuotaStatus(userId)).items.find(
      (i) => i.metric === "analyze",
    )!.used;
    assert.equal(
      usedAfterFail,
      usedBefore,
      "P2 failed final → quota inchangé",
    );
    console.log("OK 3) P2 failed final → pas de débit");
  }

  await resetJobs();
  {
    const job = await enqueueAnalysisJob({
      userId,
      documentId: "d-ok",
      historyId: "h-ok",
      fileName: "a.pdf",
    });
    await processOneAnalysisJob({
      runP2: async () => ({
        queueWaitMs: 1,
        lockWaitMs: 0,
        generateMs: 10,
        historyMs: 5,
        memoryMs: null,
        totalTokens: 0,
      }),
    });
    const done = await getAnalysisJob(job.id);
    assert.equal(done!.status, "completed");
    assert.equal(done!.metrics?.quotaCharged, true);
    const usedAfterOk = (await getQuotaStatus(userId)).items.find(
      (i) => i.metric === "analyze",
    )!.used;
    assert.equal(usedAfterOk, usedBefore + 1, "P2 completed → -1");
    console.log("OK 4) P2 completed → débit 1");
  }

  await resetJobs();
  {
    const usedBeforeRetry = (await getQuotaStatus(userId)).items.find(
      (i) => i.metric === "analyze",
    )!.used;

    const failJob = await enqueueAnalysisJob({
      userId,
      documentId: "d-retry",
      historyId: "h-retry-fail",
      fileName: "a.pdf",
    });
    await processOneAnalysisJob({
      runP2: async () => {
        throw new Error("first-attempt-fail");
      },
      fail: async (id, msg) => {
        await failAnalysisJob(id, msg);
      },
      complete: async () => {
        throw new Error("should not complete");
      },
    });
    assert.equal((await getAnalysisJob(failJob.id))!.status, "failed");
    const usedAfterFailOnly = (await getQuotaStatus(userId)).items.find(
      (i) => i.metric === "analyze",
    )!.used;
    assert.equal(usedAfterFailOnly, usedBeforeRetry, "retry block: fail sans débit");

    const okJob = await enqueueAnalysisJob({
      userId,
      documentId: "d-retry",
      historyId: "h-retry-ok",
      fileName: "a.pdf",
    });
    await processOneAnalysisJob({
      runP2: async () => ({
        queueWaitMs: 1,
        lockWaitMs: 0,
        generateMs: 10,
        historyMs: 5,
        memoryMs: null,
        totalTokens: 0,
      }),
    });
    assert.equal((await getAnalysisJob(okJob.id))!.status, "completed");

    const usedAfterRetry = (await getQuotaStatus(userId)).items.find(
      (i) => i.metric === "analyze",
    )!.used;
    assert.equal(
      usedAfterRetry,
      usedBeforeRetry + 1,
      "fail puis retry success → -1 total",
    );
    console.log("OK 5) fail puis retry success → -1 total");
  }

  void freeLimit;
    },
  );
}

async function testUpload31PagesNoDebit() {
  const upload = await readSource("src/app/api/upload/route.ts");
  const extract = await readSource("src/services/pdf/extractor.ts");
  const consumeIdx = upload.indexOf("await consumeQuota(");
  const persistIdx = upload.indexOf("await uploadPdfDocument(");
  assert.ok(consumeIdx > 0 && persistIdx > consumeIdx);
  assert.match(
    extract,
    /MAX_PDF_PAGES = 30/,
    "extraction refuse 31+ pages avant storage",
  );
  console.log("OK 2) upload 31 pages → pas de débit (extraction avant consume)");
}

async function main() {
  await testRouteContract();
  await testUpload31PagesNoDebit();
  await testWorkerQuotaIntegration();
  console.log("\nOK test-analyze-quota-on-success");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
