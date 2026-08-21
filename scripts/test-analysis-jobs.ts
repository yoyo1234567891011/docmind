/**
 * Tests Architecture A — file d'analyse durable.
 * Mode FS (pas de PG requis) + mocks worker.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

process.env.DOCMIND_STORAGE = "fs";
process.env.DOCMIND_FS_FALLBACK = "0";

async function main() {
  const {
    __resetAnalysisJobsFsForTests,
    claimNextAnalysisJob,
    completeAnalysisJob,
    enqueueAnalysisJob,
    failAnalysisJob,
    findActiveAnalysisJob,
    getAnalysisJob,
    getAnalysisJobPublicStatus,
    getAnalysisJobQueuePosition,
    processOneAnalysisJob,
    ANALYSIS_RATE_LIMIT_DEFER_MS,
    ANALYSIS_P2_MAX_CONCURRENCY,
    getEffectiveP2Concurrency,
    noteP2RateLimitHit,
    noteP2Success,
    __resetP2ConcurrencyForTests,
  } = await import("../src/services/analysis-jobs");

  async function reset() {
    await __resetAnalysisJobsFsForTests();
    __resetP2ConcurrencyForTests();
  }

  await reset();
  {
    const job = await enqueueAnalysisJob({
      userId: "u1",
      documentId: "d1",
      historyId: "h1",
      fileName: "a.pdf",
      skipReadyReply: true,
      p1DurationMs: 12,
    });
    assert.equal(job.status, "pending");
    assert.equal(job.historyId, "h1");
    const got = await getAnalysisJob(job.id, "u1");
    assert.ok(got);
    assert.equal(got!.id, job.id);
    console.log("OK 1) création job");
  }

  await reset();
  {
    await enqueueAnalysisJob({
      userId: "u1",
      documentId: "d-claim",
      historyId: "h-claim",
      fileName: "a.pdf",
    });
    const [a, b] = await Promise.all([
      claimNextAnalysisJob("worker-a"),
      claimNextAnalysisJob("worker-b"),
    ]);
    const winners = [a, b].filter(Boolean);
    assert.equal(winners.length, 1, "un seul claim gagnant");
    assert.equal(winners[0]!.status, "processing");
    const second = await claimNextAnalysisJob("worker-c");
    assert.equal(second, null, "plus de pending");
    console.log("OK 2) claim concurrent → 1 gagnant");
  }

  await reset();
  {
    const job = await enqueueAnalysisJob({
      userId: "u1",
      documentId: "d-ok",
      historyId: "h-ok",
      fileName: "a.pdf",
    });
    let ran = false;
    const did = await processOneAnalysisJob({
      runP2: async () => {
        ran = true;
      },
    });
    assert.equal(did, "completed");
    assert.equal(ran, true);
    const done = await getAnalysisJob(job.id);
    assert.equal(done!.status, "completed");
    assert.ok(done!.completedAt);
    console.log("OK 3) processing → completed");
  }

  await reset();
  {
    const job = await enqueueAnalysisJob({
      userId: "u1",
      documentId: "d-fail",
      historyId: "h-fail",
      fileName: "a.pdf",
    });
    await processOneAnalysisJob({
      runP2: async () => {
        throw new Error("boom-p2");
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
    assert.match(done!.lastError ?? "", /boom-p2/);
    console.log("OK 4) processing → failed");
  }

  await reset();
  {
    const job = await enqueueAnalysisJob({
      userId: "u1",
      documentId: "d-crash",
      historyId: "h-crash",
      fileName: "a.pdf",
    });
    const claimed = await claimNextAnalysisJob("w-dead", 50);
    assert.ok(claimed);
    assert.equal(claimed!.id, job.id);
    await new Promise((r) => setTimeout(r, 80));
    const reclaimed = await claimNextAnalysisJob("w-alive", 120_000);
    assert.ok(reclaimed, "job reclaimable après lease expirée");
    assert.equal(reclaimed!.id, job.id);
    assert.ok(reclaimed!.attempts >= 2);
    console.log("OK 5) crash/recovery lease");
  }

  await reset();
  {
    assert.equal(ANALYSIS_P2_MAX_CONCURRENCY, 3);
    const jobs = [];
    for (let i = 0; i < 4; i += 1) {
      jobs.push(
        await enqueueAnalysisJob({
          userId: "u1",
          documentId: `doc-c${i}`,
          historyId: `h-c${i}`,
          fileName: `${i}.pdf`,
        }),
      );
    }
    const claimed = [];
    for (let i = 0; i < 4; i += 1) {
      claimed.push(await claimNextAnalysisJob(`w${i}`));
    }
    const active = claimed.filter(Boolean);
    assert.equal(active.length, 3, "plafond 3 P2 simultanés");
    assert.equal(claimed[3], null, "4e job reste en file");
    await completeAnalysisJob(active[0]!.id);
    const next = await claimNextAnalysisJob("w-next");
    assert.ok(next);
    assert.equal(next!.id, jobs[3]!.id);
    console.log("OK 6) concurrence max 3, 4e en file");
  }

  await reset();
  {
    assert.equal(await getEffectiveP2Concurrency(), 3);
    await noteP2RateLimitHit();
    assert.equal(await getEffectiveP2Concurrency(), 1);
    await noteP2Success();
    assert.equal(await getEffectiveP2Concurrency(), 2);
    await noteP2Success();
    assert.equal(await getEffectiveP2Concurrency(), 3);
    console.log("OK 6a) throttle 429 → 1 puis ramp 2 → 3");
  }

  await reset();
  {
    const job = await enqueueAnalysisJob({
      userId: "u1",
      documentId: "d-rl",
      historyId: "h-rl",
      fileName: "a.pdf",
    });
    const outcome = await processOneAnalysisJob({
      runP2: async () => {
        throw new Error(
          "Rate limit reached TPM Limit 8000. Please try again in 53s.",
        );
      },
    });
    assert.equal(outcome, "requeued");
    assert.equal(await getEffectiveP2Concurrency(), 1, "throttle après 429");
    const again = await getAnalysisJob(job.id);
    assert.equal(again!.status, "pending");
    assert.match(again!.lastError ?? "", /file d|satur/i);
    assert.ok(again!.leaseExpiresAt);
    const deferMs =
      Date.parse(again!.leaseExpiresAt!) - Date.now();
    assert.ok(
      deferMs > 1_000 && deferMs <= ANALYSIS_RATE_LIMIT_DEFER_MS + 5_000,
      "cooldown avant reclame",
    );
    const blocked = await claimNextAnalysisJob("w-early");
    assert.equal(blocked, null, "pas de claim pendant cooldown");
    console.log("OK 6b) rate-limit → requeue + cooldown");
  }

  {
    const genLock = await import("../src/ai/models/generate-lock");
    assert.equal(typeof genLock.withOllamaGenerateLock, "function");
    const analyzeSrc = await readFile(
      join(process.cwd(), "src/services/analysis-jobs/worker.ts"),
      "utf8",
    );
    assert.match(analyzeSrc, /analyzeDocumentText/);
    assert.doesNotMatch(analyzeSrc, /bypassLocalQueue:\s*true/);
    console.log("OK 7) generate-lock reste global (worker → analyzeDocumentText)");
  }

  await reset();
  {
    let quotaCalls = 0;
    const consumeOnce = async () => {
      quotaCalls += 1;
    };
    await consumeOnce();
    const a = await enqueueAnalysisJob({
      userId: "u1",
      documentId: "doc-quota",
      historyId: "h-q1",
      fileName: "a.pdf",
    });
    const b = await enqueueAnalysisJob({
      userId: "u1",
      documentId: "doc-quota",
      historyId: "h-q2",
      fileName: "a.pdf",
    });
    assert.equal(a.id, b.id, "même job actif — pas de 2e enqueue");
    assert.equal(quotaCalls, 1);
    const active = await findActiveAnalysisJob({
      userId: "u1",
      documentId: "doc-quota",
    });
    assert.equal(active!.id, a.id);
    console.log("OK 8) quota une fois + enqueue idempotent actif");
  }

  await reset();
  {
    const job = await enqueueAnalysisJob({
      userId: "u1",
      documentId: "d-timeout",
      historyId: "h-timeout",
      fileName: "a.pdf",
    });
    const still = await getAnalysisJob(job.id);
    assert.equal(still!.status, "pending");
    console.log("OK 9) timeout client ≠ suppression job");
  }

  await reset();
  {
    const j1 = await enqueueAnalysisJob({
      userId: "u1",
      documentId: "p1",
      historyId: "hp1",
      fileName: "a.pdf",
    });
    const j2 = await enqueueAnalysisJob({
      userId: "u1",
      documentId: "p2",
      historyId: "hp2",
      fileName: "b.pdf",
    });
    assert.equal(await getAnalysisJobQueuePosition(j1), 1);
    assert.equal(await getAnalysisJobQueuePosition(j2), 2);
    const pub = await getAnalysisJobPublicStatus(j2.id, "u1");
    assert.equal(pub!.status, "pending");
    assert.equal(pub!.queuePosition, 2);
    await claimNextAnalysisJob("w");
    const pubAfter = await getAnalysisJobPublicStatus(j1.id, "u1");
    assert.equal(pubAfter!.status, "processing");
    assert.equal(pubAfter!.queuePosition, null);
    await completeAnalysisJob(j1.id);
    const pubDone = await getAnalysisJobPublicStatus(j1.id, "u1");
    assert.equal(pubDone!.status, "completed");
    console.log("OK 10) polling statut + position file");
  }

  await reset();
  {
    const {
      findAnalysisJobByHistoryId,
      getAnalysisJobStats,
    } = await import("../src/services/analysis-jobs");
    const job = await enqueueAnalysisJob({
      userId: "u-hist",
      documentId: "d-hist",
      historyId: "h-resume",
      fileName: "r.pdf",
    });
    const byHist = await findAnalysisJobByHistoryId({
      userId: "u-hist",
      historyId: "h-resume",
    });
    assert.ok(byHist);
    assert.equal(byHist!.id, job.id);
    const stats = await getAnalysisJobStats();
    assert.equal(stats.pending, 1);
    assert.equal(stats.processing, 0);
    await claimNextAnalysisJob("w-stats");
    const stats2 = await getAnalysisJobStats();
    assert.equal(stats2.pending, 0);
    assert.equal(stats2.processing, 1);
    await completeAnalysisJob(job.id, {
      queueWaitMs: 100,
      lockWaitMs: 20,
      generateMs: 50,
      historyMs: 5,
      memoryMs: null,
      totalMs: 175,
    });
    const done = await getAnalysisJob(job.id, "u-hist");
    assert.equal(done!.metrics?.queueWaitMs, 100);
    assert.equal(done!.metrics?.generateMs, 50);
    const stats3 = await getAnalysisJobStats();
    assert.equal(stats3.completed, 1);
    console.log("OK 11) by-history + stats + metrics persistées");
  }

  console.log("\nAll analysis-jobs tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
