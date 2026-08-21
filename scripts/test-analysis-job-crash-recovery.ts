/**
 * Crash recovery réel (FS ou PG selon DOCMIND_STORAGE) :
 * 1) job processing abandonné (lease courte)
 * 2) attente expiration
 * 3) second worker reclaim → completed
 * Vérifie : pas de double claim concurrent, pas de job perdu.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/test-analysis-job-crash-recovery.ts
 */
import {
  ANALYSIS_JOB_LEASE_MS,
  __resetAnalysisJobsFsForTests,
  claimNextAnalysisJob,
  enqueueAnalysisJob,
  getAnalysisJob,
  processOneAnalysisJob,
} from "../src/services/analysis-jobs";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  process.env.DOCMIND_STORAGE = process.env.DOCMIND_STORAGE || "fs";
  await __resetAnalysisJobsFsForTests();

  const job = await enqueueAnalysisJob({
    userId: "crash-u1",
    documentId: "crash-d1",
    historyId: "crash-h1",
    fileName: "crash.pdf",
  });
  assert(job.status === "pending", "job pending");

  // Worker A claim puis « crash » (pas de complete, lease déjà posée)
  const claimed = await claimNextAnalysisJob("worker-crash-a");
  assert(claimed?.id === job.id, "worker A claim");
  assert(claimed?.status === "processing", "processing");

  // Concurrent claim pendant lease valide → aucun gagnant
  const concurrent = await claimNextAnalysisJob("worker-crash-b");
  assert(concurrent === null, "pas de double claim sous lease");

  // Force expiration lease (mutation FS directe via re-claim window)
  // On attend la lease réelle serait trop long (120s) — on simule via
  // claimNext qui lit lease_expires_at. Pour FS on expire en récrivant.
  const { readFile, writeFile } = await import("fs/promises");
  const path = await import("path");
  const { SYSTEM_DIR } = await import("../src/config/paths");
  const file = path.join(SYSTEM_DIR, "analysis-jobs.json");
  const raw = JSON.parse(await readFile(file, "utf8")) as {
    jobs: Array<{
      id: string;
      status: string;
      leaseExpiresAt?: string;
      claimedBy?: string;
    }>;
  };
  const idx = raw.jobs.findIndex((j) => j.id === job.id);
  assert(idx >= 0, "job in FS");
  raw.jobs[idx] = {
    ...raw.jobs[idx]!,
    leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
  };
  await writeFile(file, JSON.stringify(raw, null, 2), "utf8");

  const reclaimed = await claimNextAnalysisJob("worker-crash-b");
  assert(reclaimed?.id === job.id, "worker B reclaim après lease");
  assert(reclaimed?.claimedBy === "worker-crash-b", "owned by B");

  // Deux claims simultanés post-expire → 1 gagnant
  raw.jobs[idx] = {
    ...raw.jobs[idx]!,
    status: "processing",
    leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
    claimedBy: "ghost",
  };
  await writeFile(file, JSON.stringify(raw, null, 2), "utf8");

  const [c1, c2] = await Promise.all([
    claimNextAnalysisJob("w1"),
    claimNextAnalysisJob("w2"),
  ]);
  const winners = [c1, c2].filter(Boolean);
  assert(winners.length === 1, `exactement 1 winner, got ${winners.length}`);

  // Completer via worker stub (sans Ollama)
  await __resetAnalysisJobsFsForTests();
  const j2 = await enqueueAnalysisJob({
    userId: "crash-u2",
    documentId: "crash-d2",
    historyId: "crash-h2",
    fileName: "crash2.pdf",
  });
  // Expire immédiatement après claim stub
  const a = await claimNextAnalysisJob("die");
  assert(a?.id === j2.id, "claim die");
  const raw2 = JSON.parse(await readFile(file, "utf8")) as {
    jobs: Array<{ id: string; leaseExpiresAt?: string }>;
  };
  const i2 = raw2.jobs.findIndex((j) => j.id === j2.id);
  raw2.jobs[i2]!.leaseExpiresAt = new Date(Date.now() - 1).toISOString();
  await writeFile(file, JSON.stringify(raw2, null, 2), "utf8");

  let runs = 0;
  await processOneAnalysisJob({
    workerId: "resurrect",
    runP2: async () => {
      runs += 1;
      return {
        queueWaitMs: 10,
        lockWaitMs: 0,
        generateMs: 1,
        historyMs: 1,
        memoryMs: null,
      };
    },
  });
  assert(runs === 1, "P2 run once");
  const done = await getAnalysisJob(j2.id);
  assert(done?.status === "completed", "completed after recovery");
  assert(done?.metrics?.queueWaitMs === 10, "metrics persisted");

  // Second process ne reprend pas un completed
  const again = await processOneAnalysisJob({
    workerId: "noop",
    runP2: async () => {
      runs += 1;
    },
  });
  assert(again === "idle", "no reclaim of completed");
  assert(runs === 1, "no double analyse");

  console.log("LEASE_MS_DEFAULT", ANALYSIS_JOB_LEASE_MS);
  console.log("OK crash-recovery (FS simulated lease expiry)");
}

main().catch((e) => {
  console.error("FAIL", e instanceof Error ? e.message : e);
  process.exit(1);
});
