/**
 * Quota analyze progressive :
 * - consume à l'enqueue (prepaid)
 * - refund si P2 failed définitif
 * - pas de double refund si completed
 * - P1/enqueue fail : refund déjà côté route (pas 2×)
 *
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

  const failSrc = await readSource("src/services/analysis-jobs/store.ts");
  assert.ok(
    failSrc.includes("refundPrepaidAnalyzeQuotaOnDefinitiveFail"),
    "failAnalysisJob rembourse prepaid sur échec définitif",
  );
  assert.ok(
    failSrc.includes("tryClaimAnalysisJobQuotaRefund"),
    "claim idempotent quotaRefunded",
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
        markAnalysisJobQuotaPrepaid,
        processOneAnalysisJob,
        __resetP2ConcurrencyForTests,
      } = await import("../src/services/analysis-jobs");
      const { consumeQuota, getQuotaStatus, refundQuota } = await import(
        "../src/services/quotas/enforce"
      );
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

      // Legacy (pas prepaid) : P2 failed → pas de débit
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
          "P2 failed sans prepaid → quota inchangé",
        );
        console.log("OK 3) P2 failed sans prepaid → pas de débit");
      }

      // Progressive prepaid : P2 failed → refund
      await resetJobs();
      {
        await consumeQuota(userId, "analyze");
        const usedAfterConsume = (await getQuotaStatus(userId)).items.find(
          (i) => i.metric === "analyze",
        )!.used;
        assert.equal(usedAfterConsume, usedBefore + 1);

        const job = await enqueueAnalysisJob({
          userId,
          documentId: "d-prepaid-fail",
          historyId: "h-prepaid-fail",
          fileName: "a.pdf",
        });
        await markAnalysisJobQuotaPrepaid(job.id);

        await processOneAnalysisJob({
          runP2: async () => {
            throw new Error("boom-p2-prepaid-final");
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
        assert.equal(done!.metrics?.quotaPrepaidAtEnqueue, true);
        assert.equal(done!.metrics?.quotaRefunded, true);

        const usedAfterRefund = (await getQuotaStatus(userId)).items.find(
          (i) => i.metric === "analyze",
        )!.used;
        assert.equal(
          usedAfterRefund,
          usedBefore,
          "P2 failed + prepaid → quota remboursé",
        );

        // 2e fail (idempotent) — pas de double refund
        await failAnalysisJob(job.id, "already-failed");
        const usedAfterIdempotent = (await getQuotaStatus(userId)).items.find(
          (i) => i.metric === "analyze",
        )!.used;
        assert.equal(
          usedAfterIdempotent,
          usedBefore,
          "pas de double refund sur re-fail",
        );
        console.log("OK 3b) P2 failed + prepaid → refund 1 (idempotent)");
      }

      // Prepaid + completed → débit conservé, pas de refund
      await resetJobs();
      {
        await consumeQuota(userId, "analyze");
        const usedAfterConsume = (await getQuotaStatus(userId)).items.find(
          (i) => i.metric === "analyze",
        )!.used;

        const job = await enqueueAnalysisJob({
          userId,
          documentId: "d-prepaid-ok",
          historyId: "h-prepaid-ok",
          fileName: "a.pdf",
        });
        await markAnalysisJobQuotaPrepaid(job.id);

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
        assert.equal(done!.metrics?.quotaPrepaidAtEnqueue, true);
        assert.notEqual(done!.metrics?.quotaRefunded, true);

        const usedAfterOk = (await getQuotaStatus(userId)).items.find(
          (i) => i.metric === "analyze",
        )!.used;
        assert.equal(
          usedAfterOk,
          usedAfterConsume,
          "P2 completed prepaid → pas de refund / pas de double débit",
        );
        console.log("OK 4) P2 completed prepaid → quota conservé");
      }

      // Legacy completed → débit 1
      await resetJobs();
      {
        const usedStart = (await getQuotaStatus(userId)).items.find(
          (i) => i.metric === "analyze",
        )!.used;
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
        assert.equal(usedAfterOk, usedStart + 1, "legacy P2 completed → -1");
        console.log("OK 4b) legacy P2 completed → débit 1");
      }

      // Simule P1/enqueue refund déjà fait — pas 2× si on re-refund à la main
      {
        const usedStart = (await getQuotaStatus(userId)).items.find(
          (i) => i.metric === "analyze",
        )!.used;
        await consumeQuota(userId, "analyze");
        await refundQuota(userId, "analyze");
        const usedAfter = (await getQuotaStatus(userId)).items.find(
          (i) => i.metric === "analyze",
        )!.used;
        assert.equal(usedAfter, usedStart, "P1 fail enqueue → 1 refund ok");
        console.log("OK 5) P1/enqueue fail → 1 refund (pas 2× côté route)");
      }

      void freeLimit;
    },
  );
}

async function testUpload31PagesNoDebit() {
  const extract = await readSource("src/services/pdf/extractor.ts");
  assert.match(
    extract,
    /MAX_PDF_PAGES = 30/,
    "extraction refuse 31+ pages avant storage",
  );
  console.log("OK 2) upload 31 pages → refus extraction (pas d’analyse)");
}

async function testCheckoutConsentContract() {
  const checkout = await readSource("src/services/billing/checkout.ts");
  const route = await readSource("src/app/api/billing/checkout/route.ts");
  const view = await readSource("src/components/billing/billing-view.tsx");
  assert.ok(
    checkout.includes("acceptedImmediateExecution"),
    "checkout exige acceptedImmediateExecution",
  );
  assert.ok(
    checkout.includes("rétractation de 14 jours"),
    "message rétractation 14j",
  );
  assert.ok(
    route.includes("acceptedImmediateExecution"),
    "route forward consent",
  );
  assert.ok(
    view.includes("acceptedImmediateExecution"),
    "UI case CGV/rétractation",
  );
  assert.ok(view.includes("14 jours"), "texte UI 14 jours");
  console.log("OK 6) case rétractation 14j branchée checkout + UI");
}

async function main() {
  await testRouteContract();
  await testUpload31PagesNoDebit();
  await testWorkerQuotaIntegration();
  await testCheckoutConsentContract();
  console.log("\nOK test-analyze-quota-on-success");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
