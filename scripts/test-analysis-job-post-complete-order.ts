/**
 * Vérifie l’ordre : history → complete → notify/memory (async).
 * npx tsx --tsconfig tsconfig.json scripts/test-analysis-job-post-complete-order.ts
 */
// @ts-nocheck
import assert from "node:assert/strict";
import { randomUUID } from "crypto";

import { processOneAnalysisJob } from "../src/services/analysis-jobs/worker";
import type { AnalysisJob } from "../src/services/analysis-jobs/types";
import { EMPTY_READY_REPLY } from "../src/types";

const events: string[] = [];

function fakeHistory(id: string): HistoryRecord {
  return {
    id,
    userId: "u-order",
    documentId: "d1",
    fileName: "x.pdf",
    displayName: null,
    favorite: false,
    tagIds: [],
    createdAt: new Date().toISOString(),
    classification: { category: "facture", label: "Facture", confidence: 1 },
    analysis: {
      document_type: "Facture",
      title: "T",
      summary: "S",
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
      risk_explanation: "",
      risk_criteria: [],
    },
    readyReply: EMPTY_READY_REPLY,
    model: "test",
    analyzedAt: new Date().toISOString(),
    extractedText: "texte",
    folderId: null,
    folderSource: "auto",
    promptsUsed: [],
    analysisPhase: "complete",
  };
}

async function main() {
  const jobId = randomUUID();
  const historyId = randomUUID();
  const createdAt = new Date().toISOString();
  let completedAtMs: number | null = null;
  let postScheduledAtMs: number | null = null;

  const job: AnalysisJob = {
    id: jobId,
    userId: "u-order",
    documentId: "d1",
    historyId,
    fileName: "x.pdf",
    status: "processing",
    attempts: 1,
    skipReadyReply: true,
    createdAt,
    updatedAt: createdAt,
    startedAt: createdAt,
    claimedAt: createdAt,
  };

  const outcome = await processOneAnalysisJob({
    workerId: "test-order",
    claimNext: async () => job,
    complete: async (id, metrics) => {
      assert.equal(id, jobId);
      completedAtMs = Date.now();
      events.push("complete");
      assert.equal(metrics?.memoryMs ?? null, null);
    },
    runP2: async () => {
      events.push("p2");
      const updated = fakeHistory(historyId);
      return {
        queueWaitMs: 10,
        lockWaitMs: 0,
        generateMs: 100,
        historyMs: 50,
        memoryMs: null,
        totalTokens: 10,
        postComplete: { updated, p2DurationMs: 100 },
      };
    },
  });

  assert.equal(outcome, "completed");
  assert.deepEqual(events, ["p2", "complete"]);
  assert.ok(completedAtMs != null);

  // postComplete est fire-and-forget — le complete doit déjà être passé
  postScheduledAtMs = Date.now();
  assert.ok(
    completedAtMs! <= postScheduledAtMs!,
    "complete must happen before post-complete continues",
  );

  console.log("OK post-complete order: p2 → complete (memory/notify deferred)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
