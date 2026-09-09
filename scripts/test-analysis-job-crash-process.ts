/**
 * Crash processus réel (FS) :
 * - child claim + sleep (lease courte)
 * - parent kill -9
 * - attente expiration lease (temps réel)
 * - reclaim unique + complete
 * - history preview → complete ; pas de double claim / pas de memory fantôme
 *
 * Usage: npm run test:analysis-job-crash-process
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

process.env.DOCMIND_STORAGE = "fs";
process.env.DOCMIND_FS_FALLBACK = "0";

const ROOT = process.cwd();
const MARKER_DIR = path.join(ROOT, "data", "system", "crash-markers");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function waitForFile(file: string, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await readFile(file, "utf8");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`timeout waiting for ${file}`);
}

async function main() {
  const {
    __resetAnalysisJobsFsForTests,
    claimNextAnalysisJob,
    completeAnalysisJob,
    enqueueAnalysisJob,
    getAnalysisJob,
    processOneAnalysisJob,
  } = await import("../src/services/analysis-jobs");
  const { saveHistoryRecord, getHistoryRecord, updateHistoryRecord } =
    await import("../src/services/history");
  const { SYSTEM_DIR } = await import("../src/config/paths");

  await mkdir(MARKER_DIR, { recursive: true });
  await __resetAnalysisJobsFsForTests();

  const runId = randomUUID().slice(0, 8);
  const claimedMarker = path.join(MARKER_DIR, `${runId}-claimed`);
  const leaseMs = 2_500;
  const userId = `crash-proc-${runId}`;

  const { EMPTY_READY_REPLY } = await import("../src/types/reply");

  const history = await saveHistoryRecord(userId, {
    result: {
      documentId: `d-${runId}`,
      classification: {
        category: "autre",
        label: "Test",
        confidence: 0.5,
      },
      analysis: {
        document_type: "test",
        title: "crash",
        summary: "preview",
        date: "",
        dates: [],
        people: [],
        organizations: [],
        amounts: [],
        deadlines: [],
        important_points: [],
        risks: [],
        actions: [],
        risk_score: 0,
        risk_level: "faible",
        risk_explanation: "test",
        risk_criteria: [],
      },
      readyReply: EMPTY_READY_REPLY,
      model: "test",
      analyzedAt: new Date().toISOString(),
      promptsUsed: [],
      phase: "preview",
    },
    fileName: "crash-proc.pdf",
    extractedText: "texte crash process",
  });
  assert(history.analysisPhase === "preview", "history preview");

  const job = await enqueueAnalysisJob({
    userId,
    documentId: history.documentId,
    historyId: history.id,
    fileName: "crash-proc.pdf",
  });
  assert(job.status === "pending", "pending");

  const tsxCli = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(
    process.execPath,
    [
      tsxCli,
      "--tsconfig",
      path.join(ROOT, "tsconfig.json"),
      path.join(ROOT, "scripts", "crash-child-worker.ts"),
      "--marker",
      claimedMarker,
      "--lease-ms",
      String(leaseMs),
    ],
    {
      cwd: ROOT,
      env: { ...process.env, DOCMIND_STORAGE: "fs", DOCMIND_FS_FALLBACK: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  let childErr = "";
  child.stderr?.on("data", (b) => {
    childErr += String(b);
  });

  try {
    await waitForFile(claimedMarker, 20_000);
  } catch (e) {
    child.kill("SIGKILL");
    throw new Error(
      `child n’a pas claimé: ${e instanceof Error ? e.message : e}; stderr=${childErr}`,
    );
  }

  const marker = JSON.parse(await readFile(claimedMarker, "utf8")) as {
    id: string;
  };
  assert(marker.id === job.id, "child claimed our job");

  const mid = await claimNextAnalysisJob("parent-early", leaseMs);
  assert(mid === null, "pas de reclaim sous lease active");

  const killed = child.kill("SIGKILL");
  assert(killed, "SIGKILL envoyé");
  await new Promise<void>((resolve) => {
    child.on("exit", () => resolve());
    setTimeout(resolve, 3_000);
  });

  await new Promise((r) => setTimeout(r, leaseMs + 800));

  const [a, b] = await Promise.all([
    claimNextAnalysisJob("parent-a", 30_000),
    claimNextAnalysisJob("parent-b", 30_000),
  ]);
  const winners = [a, b].filter(Boolean);
  assert(winners.length === 1, `1 reclaim gagnant, got ${winners.length}`);
  assert(winners[0]!.id === job.id, "reclaim du bon job");
  assert(
    winners[0]!.lastError === "reclaimed_stale_lease" ||
      (winners[0]!.attempts ?? 0) >= 2,
    "marqué reclaim / attempts≥2",
  );

  await updateHistoryRecord(userId, history.id, {
    analysisPhase: "complete",
    analysis: {
      ...history.analysis,
      summary: "completed after reclaim",
    },
  });
  await completeAnalysisJob(job.id, {
    queueWaitMs: 1,
    lockWaitMs: 0,
    generateMs: 2,
    historyMs: 1,
    memoryMs: null,
    totalMs: 4,
  });

  const done = await getAnalysisJob(job.id);
  assert(done?.status === "completed", "completed après reclaim");
  const histAfter = await getHistoryRecord(userId, history.id);
  assert(histAfter.analysisPhase === "complete", "history complete");
  assert(
    !histAfter.memorySyncedAt,
    "memory non écrite par stub (pas de double memory)",
  );

  const again = await claimNextAnalysisJob("after-done");
  assert(again === null || again.id !== job.id, "completed non reclaimable");

  // Reclaim via processOneAnalysisJob
  await __resetAnalysisJobsFsForTests();
  const h2 = await saveHistoryRecord(userId, {
    result: {
      documentId: `d2-${runId}`,
      classification: history.classification,
      analysis: history.analysis,
      readyReply: history.readyReply,
      model: "test",
      analyzedAt: new Date().toISOString(),
      promptsUsed: [],
      phase: "preview",
    },
    fileName: "crash2.pdf",
    extractedText: "texte 2",
  });
  const j2 = await enqueueAnalysisJob({
    userId,
    documentId: h2.documentId,
    historyId: h2.id,
    fileName: "crash2.pdf",
  });
  const ghost = await claimNextAnalysisJob("ghost", 1);
  assert(ghost?.id === j2.id, "ghost claim");
  const jobsFile = path.join(SYSTEM_DIR, "analysis-jobs.json");
  const raw = JSON.parse(await readFile(jobsFile, "utf8")) as {
    jobs: Array<{ id: string; leaseExpiresAt?: string }>;
  };
  const idx = raw.jobs.findIndex((j) => j.id === j2.id);
  raw.jobs[idx]!.leaseExpiresAt = new Date(Date.now() - 1000).toISOString();
  await writeFile(jobsFile, JSON.stringify(raw, null, 2), "utf8");

  let runs = 0;
  await processOneAnalysisJob({
    workerId: "resurrect",
    runP2: async (jobArg) => {
      runs += 1;
      await updateHistoryRecord(jobArg.userId, jobArg.historyId, {
        analysisPhase: "complete",
      });
      return {
        queueWaitMs: 5,
        lockWaitMs: 0,
        generateMs: 3,
        historyMs: 1,
        memoryMs: null,
      };
    },
  });
  assert(runs === 1, "P2 once");
  const j2done = await getAnalysisJob(j2.id);
  assert(j2done?.status === "completed", "j2 completed");
  const h2after = await getHistoryRecord(userId, h2.id);
  assert(h2after.analysisPhase === "complete", "h2 complete");

  await unlink(claimedMarker).catch(() => undefined);
  console.log(
    "OK crash-process réel (SIGKILL + lease wait + reclaim unique + history)",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
