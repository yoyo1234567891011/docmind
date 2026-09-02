/**
 * Tests watchdog drain (cron) + isolation ALS timings.
 */
import assert from "node:assert/strict";

process.env.DOCMIND_STORAGE = "fs";
process.env.DOCMIND_FS_FALLBACK = "0";
process.env.CRON_SECRET = "test-cron-secret-drain-xyz";

async function main() {
  const {
    __resetAnalysisJobsFsForTests,
    claimNextAnalysisJob,
    drainAnalysisJobs,
    enqueueAnalysisJob,
    failAnalysisJob,
    getAnalysisJob,
    getAnalysisJobStats,
  } = await import("../src/services/analysis-jobs");
  const {
    addAnalysisGenerateMs,
    addAnalysisLockWaitMs,
    createAnalysisTimingBucket,
    runWithAnalysisTiming,
  } = await import("../src/services/analysis-jobs/timing");
  const { assertCronAuthorized } = await import("../src/lib/cron-auth");
  const { AppError } = await import("../src/lib/errors");

  // 1) Auth cron
  assert.throws(
    () =>
      assertCronAuthorized(
        new Request("http://x/api/cron/drain-analysis-jobs", {
          method: "POST",
        }),
      ),
    (e: unknown) => e instanceof AppError && e.status === 401,
  );
  assert.doesNotThrow(() =>
    assertCronAuthorized(
      new Request("http://x/api/cron/drain-analysis-jobs", {
        method: "POST",
        headers: { Authorization: "Bearer test-cron-secret-drain-xyz" },
      }),
    ),
  );
  assert.doesNotThrow(() =>
    assertCronAuthorized(
      new Request("http://x/api/cron/drain-analysis-jobs", {
        method: "POST",
        headers: { "x-cron-secret": "test-cron-secret-drain-xyz" },
      }),
    ),
  );
  const prevSecret = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  assert.throws(
    () =>
      assertCronAuthorized(
        new Request("http://x/api/cron/drain-analysis-jobs", {
          method: "POST",
          headers: { Authorization: "Bearer anything" },
        }),
      ),
    (e: unknown) => e instanceof AppError && e.status === 503,
  );
  process.env.CRON_SECRET = prevSecret;
  console.log("OK 1) cron auth (Bearer / x-cron-secret / secret manquant → 503)");

  // 2) ALS isolation — deux buckets parallèles ne se mélangent pas
  const b1 = createAnalysisTimingBucket();
  const b2 = createAnalysisTimingBucket();
  await Promise.all([
    runWithAnalysisTiming(b1, async () => {
      addAnalysisLockWaitMs(10);
      await new Promise((r) => setTimeout(r, 30));
      addAnalysisGenerateMs(100);
    }),
    runWithAnalysisTiming(b2, async () => {
      addAnalysisLockWaitMs(20);
      await new Promise((r) => setTimeout(r, 10));
      addAnalysisGenerateMs(200);
    }),
  ]);
  assert.equal(b1.lockWaitMs, 10);
  assert.equal(b1.generateMs, 100);
  assert.equal(b2.lockWaitMs, 20);
  assert.equal(b2.generateMs, 200);
  console.log("OK 2) ALS isolation buckets parallèles");

  // 3) Drain sans after() — job pending → completed via drain (aucun trafic UI)
  await __resetAnalysisJobsFsForTests();
  const job = await enqueueAnalysisJob({
    userId: "drain-u",
    documentId: "drain-d",
    historyId: "drain-h",
    fileName: "d.pdf",
  });
  assert.equal(job.status, "pending");
  const n = await drainAnalysisJobs(2, {
    runP2: async () => ({
      queueWaitMs: 5,
      lockWaitMs: 1,
      generateMs: 9,
      historyMs: 2,
      memoryMs: null,
    }),
  });
  assert.equal(n, 1);
  const done = await getAnalysisJob(job.id, "drain-u");
  assert.equal(done?.status, "completed");
  assert.equal(done?.metrics?.generateMs, 9);
  console.log("OK 3) drain traite pending sans after()");

  // 3b) Drain idempotent — file vide / déjà terminé → 0
  const nEmpty = await drainAnalysisJobs(3, {
    runP2: async () => {
      throw new Error("ne doit pas tourner");
    },
  });
  assert.equal(nEmpty, 0);
  const again = await claimNextAnalysisJob("after-done");
  assert.equal(again, null);
  console.log("OK 3b) drain idempotent (completed non reclaimable)");

  // 4) Drain reclaim lease expirée
  await __resetAnalysisJobsFsForTests();
  const stale = await enqueueAnalysisJob({
    userId: "drain-u2",
    documentId: "drain-d2",
    historyId: "drain-h2",
    fileName: "d2.pdf",
  });
  const claimed = await claimNextAnalysisJob("ghost", 1);
  assert.ok(claimed);
  // force expire
  const { readFile, writeFile } = await import("fs/promises");
  const path = await import("path");
  const { SYSTEM_DIR } = await import("../src/config/paths");
  const file = path.join(SYSTEM_DIR, "analysis-jobs.json");
  const raw = JSON.parse(await readFile(file, "utf8")) as {
    jobs: Array<{ id: string; leaseExpiresAt?: string }>;
  };
  const idx = raw.jobs.findIndex((j) => j.id === stale.id);
  raw.jobs[idx]!.leaseExpiresAt = new Date(Date.now() - 5_000).toISOString();
  await writeFile(file, JSON.stringify(raw, null, 2), "utf8");

  const n2 = await drainAnalysisJobs(1, {
    runP2: async () => ({
      queueWaitMs: 3,
      lockWaitMs: 0,
      generateMs: 4,
      historyMs: 1,
      memoryMs: null,
    }),
  });
  assert.equal(n2, 1);
  const after = await getAnalysisJob(stale.id, "drain-u2");
  assert.equal(after?.status, "completed");
  assert.ok((after?.attempts ?? 0) >= 2);
  const stats = await getAnalysisJobStats();
  assert.ok(stats.reclaimed >= 1);
  console.log("OK 4) drain reclaim lease expirée");

  // 5) kick rate-limité (pas de job réel — évite Ollama)
  const {
    scheduleAnalysisDrainKick,
    __resetAnalysisDrainKickForTests,
  } = await import("../src/services/analysis-jobs");
  __resetAnalysisDrainKickForTests();
  scheduleAnalysisDrainKick(1);
  scheduleAnalysisDrainKick(1); // no-op (rate limit / in-flight)
  console.log("OK 5) scheduleAnalysisDrainKick rate-limité");

  // 6) failed terminal — non reclaimable ; drain no-op
  await __resetAnalysisJobsFsForTests();
  const failJob = await enqueueAnalysisJob({
    userId: "drain-fail",
    documentId: "drain-fail-d",
    historyId: "drain-fail-h",
    fileName: "f.pdf",
  });
  const failClaim = await claimNextAnalysisJob("w-fail");
  assert.ok(failClaim);
  await failAnalysisJob(failClaim!.id, "simulated P2 failure");
  assert.equal((await getAnalysisJob(failJob.id))?.status, "failed");
  assert.equal(await claimNextAnalysisJob("w-fail-2"), null);
  assert.equal(
    await drainAnalysisJobs(2, {
      runP2: async () => {
        throw new Error("ne doit pas retraiter un failed");
      },
    }),
    0,
  );
  console.log("OK 6) job failed terminal — pas de reclaim / drain");

  // 7) deux drains concurrents → un seul runP2 (pas de double claim)
  await __resetAnalysisJobsFsForTests();
  await enqueueAnalysisJob({
    userId: "drain-conc",
    documentId: "drain-conc-d",
    historyId: "drain-conc-h",
    fileName: "c.pdf",
  });
  let p2Calls = 0;
  const runP2 = async () => {
    p2Calls += 1;
    await new Promise((r) => setTimeout(r, 40));
    return {
      queueWaitMs: 1,
      lockWaitMs: 0,
      generateMs: 2,
      historyMs: 1,
      memoryMs: null,
    };
  };
  const [a, b] = await Promise.all([
    drainAnalysisJobs(2, { runP2, workerId: "drain-a" }),
    drainAnalysisJobs(2, { runP2, workerId: "drain-b" }),
  ]);
  assert.equal(a + b, 1);
  assert.equal(p2Calls, 1);
  console.log("OK 7) drains concurrents — un seul claim / runP2");

  // 8) drain propage failed (runP2 throw) — état explicite
  await __resetAnalysisJobsFsForTests();
  const errJob = await enqueueAnalysisJob({
    userId: "drain-err",
    documentId: "drain-err-d",
    historyId: "drain-err-h",
    fileName: "e.pdf",
  });
  const nFail = await drainAnalysisJobs(1, {
    runP2: async () => {
      throw new AppError("OLLAMA_UNAVAILABLE", "timeout simulé", 504);
    },
  });
  assert.equal(nFail, 0);
  const failed = await getAnalysisJob(errJob.id);
  assert.equal(failed?.status, "pending");
  assert.match(failed?.lastError ?? "", /file d'attente|quota ia/i);
  console.log("OK 8) drain → timeout 504 requeue (pas failed terminal)");

  console.log("\nAll analysis-job-drain tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
