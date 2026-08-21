/**
 * Tests métriques réelles (timestamps) — pas d’heuristique p2-1000.
 */
import assert from "node:assert/strict";

process.env.DOCMIND_STORAGE = "fs";
process.env.DOCMIND_FS_FALLBACK = "0";

async function main() {
  const {
    __resetAnalysisJobsFsForTests,
    claimNextAnalysisJob,
    completeAnalysisJob,
    enqueueAnalysisJob,
    getAnalysisJob,
    getAnalysisJobStats,
    processOneAnalysisJob,
  } = await import("../src/services/analysis-jobs");
  const {
    addAnalysisGenerateMs,
    addAnalysisLockWaitMs,
    createAnalysisTimingBucket,
    runWithAnalysisTiming,
  } = await import("../src/services/analysis-jobs/timing");

  await __resetAnalysisJobsFsForTests();

  const bucket = createAnalysisTimingBucket();
  await runWithAnalysisTiming(bucket, async () => {
    addAnalysisLockWaitMs(40);
    addAnalysisGenerateMs(120);
    addAnalysisGenerateMs(30);
  });
  assert.equal(bucket.lockWaitMs, 40);
  assert.equal(bucket.generateMs, 150);
  console.log("OK 1) timing bucket ALS lock/generate");

  const created = await enqueueAnalysisJob({
    userId: "m-u",
    documentId: "m-d",
    historyId: "m-h",
    fileName: "m.pdf",
  });
  // Simule attente file : claim après délai
  await new Promise((r) => setTimeout(r, 80));
  const claimed = await claimNextAnalysisJob("m-w");
  assert.ok(claimed);
  assert.equal(claimed!.id, created.id);
  const queueWaitMs = Math.max(
    0,
    Date.parse(claimed!.startedAt ?? claimed!.claimedAt!) -
      Date.parse(claimed!.createdAt),
  );
  assert.ok(queueWaitMs >= 50, `queueWait réel attendu ≥50, got ${queueWaitMs}`);

  await completeAnalysisJob(claimed!.id, {
    queueWaitMs,
    lockWaitMs: bucket.lockWaitMs,
    generateMs: bucket.generateMs,
    historyMs: 7,
    memoryMs: null,
    totalMs: queueWaitMs + 200,
  });
  const done = await getAnalysisJob(claimed!.id, "m-u");
  assert.equal(done!.metrics?.queueWaitMs, queueWaitMs);
  assert.equal(done!.metrics?.generateMs, 150);
  assert.ok(
    done!.metrics!.queueWaitMs !== (done!.metrics!.totalMs ?? 0) - 1000,
    "queueWait ne doit pas être une heuristique total-1000",
  );
  console.log("OK 2) queueWaitMs timestamp réel + persist");

  await __resetAnalysisJobsFsForTests();
  await enqueueAnalysisJob({
    userId: "m-u2",
    documentId: "m-d2",
    historyId: "m-h2",
    fileName: "m2.pdf",
  });
  const stale = await claimNextAnalysisJob("ghost", 1);
  assert.ok(stale);
  // expire lease
  const { readFile, writeFile } = await import("fs/promises");
  const path = await import("path");
  const { SYSTEM_DIR } = await import("../src/config/paths");
  const file = path.join(SYSTEM_DIR, "analysis-jobs.json");
  const raw = JSON.parse(await readFile(file, "utf8")) as {
    jobs: Array<{ id: string; leaseExpiresAt?: string; status: string }>;
  };
  const idx = raw.jobs.findIndex((j) => j.id === stale!.id);
  raw.jobs[idx]!.leaseExpiresAt = new Date(Date.now() - 5_000).toISOString();
  await writeFile(file, JSON.stringify(raw, null, 2), "utf8");

  const reclaimed = await claimNextAnalysisJob("alive");
  assert.ok(reclaimed);
  assert.equal(reclaimed!.lastError, "reclaimed_stale_lease");
  const stats = await getAnalysisJobStats();
  assert.ok(stats.reclaimed >= 1);
  assert.equal(stats.processing, 1);
  console.log("OK 3) reclaim compté dans stats");

  // Worker metrics path
  await __resetAnalysisJobsFsForTests();
  const job = await enqueueAnalysisJob({
    userId: "m-u3",
    documentId: "m-d3",
    historyId: "m-h3",
    fileName: "m3.pdf",
  });
  const did = await processOneAnalysisJob({
    runP2: async (j) => ({
      queueWaitMs: 11,
      lockWaitMs: 22,
      generateMs: 33,
      historyMs: 4,
      memoryMs: null,
    }),
  });
  assert.equal(did, "completed");
  const finished = await getAnalysisJob(job.id, "m-u3");
  assert.equal(finished!.status, "completed");
  assert.equal(finished!.metrics?.lockWaitMs, 22);
  assert.equal(finished!.metrics?.generateMs, 33);
  console.log("OK 4) worker persiste metrics");

  console.log("\nAll analysis-job-metrics tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
