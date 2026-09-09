/**
 * Concurrence FS : save∥delete, reindex∥reindex, deletes rapides.
 * Vérifie l’état FINAL. Stockage FS isolé — JAMAIS la production.
 */
import assert from "assert";
import { randomUUID } from "crypto";
import { rm } from "fs/promises";
import path from "path";

import {
  ensureUserWorkspace,
  resetUserWorkspaceCache,
} from "../src/services/auth/workspace";
import {
  deleteHistoryRecord,
  getHistoryRecord,
  listHistoryRecords,
  saveHistoryRecord,
  updateHistoryRecord,
} from "../src/services/history/store";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import { EMPTY_READY_REPLY } from "../src/types";
import type { AnalyzeDocumentResult } from "../src/types/analysis";

function forceFs() {
  process.env.DOCMIND_STORAGE = "fs";
  process.env.DOCMIND_FS_FALLBACK = "0";
  process.env.DOCMIND_FS_DUAL_WRITE = "0";
  delete process.env.DATABASE_URL;
  delete process.env.REDIS_URL;
}

function makeResult(
  documentId: string,
  title: string,
  amountHint: string,
): AnalyzeDocumentResult {
  return {
    documentId,
    model: "gpt-oss:120b",
    analyzedAt: new Date().toISOString(),
    classification: {
      category: "contrat",
      label: "Contrat",
      confidence: 0.9,
    },
    analysis: {
      document_type: "Contrat",
      title,
      summary: amountHint,
      date: "2026-01-15",
      dates: ["15/01/2026"],
      people: [],
      organizations: ["Orange"],
      amounts: [amountHint],
      deadlines: [],
      important_points: [],
      risks: [],
      actions: [],
      risk_score: 10,
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
      risk_findings: [],
    },
    readyReply: EMPTY_READY_REPLY,
    phase: "complete",
  };
}

async function main() {
  forceFs();
  resetUserWorkspaceCache();
  const userId = `conc-${Date.now()}`;
  await ensureUserWorkspace(userId);

  // --- save A + delete A concurrent ---
  const docA = randomUUID();
  const savedA = await saveHistoryRecord(userId, {
    result: makeResult(docA, "DocA", "30 EUR"),
    fileName: "a.pdf",
    extractedText: "30 EUR",
  });
  const raceResults = await Promise.allSettled([
    updateHistoryRecord(userId, savedA.id, {
      analysis: {
        ...savedA.analysis,
        title: "DocA-upd",
        summary: "31 EUR",
      },
    }),
    (async () => {
      await new Promise((r) => setTimeout(r, 5));
      await deleteHistoryRecord(userId, savedA.id);
    })(),
  ]);
  // Au moins une opération OK ; l’autre peut être NOT_FOUND selon l’ordre
  assert.ok(
    raceResults.some((r) => r.status === "fulfilled"),
    "au moins une des ops concurrentes doit réussir",
  );
  try {
    await deleteHistoryRecord(userId, savedA.id);
  } catch {
    /* déjà supprimé */
  }
  try {
    await getHistoryRecord(userId, savedA.id);
    assert.fail("DocA doit être absent après la course");
  } catch (err) {
    assert.ok(
      err instanceof Error && /introuvable|NOT_FOUND/i.test(String(err)),
      String(err),
    );
  }

  // --- save A + save B parallele ---
  const docB = randomUUID();
  const docC = randomUUID();
  const [rB, rC] = await Promise.all([
    saveHistoryRecord(userId, {
      result: makeResult(docB, "DocB", "50 EUR"),
      fileName: "b.pdf",
      extractedText: "50 EUR",
    }),
    saveHistoryRecord(userId, {
      result: makeResult(docC, "DocC", "20 EUR"),
      fileName: "c.pdf",
      extractedText: "20 EUR",
    }),
  ]);
  const list1 = await listHistoryRecords(userId);
  assert.ok(list1.some((i) => i.documentId === docB));
  assert.ok(list1.some((i) => i.documentId === docC));

  // --- reindex même id (V2∥V3) ---
  const docR = randomUUID();
  const base = await saveHistoryRecord(userId, {
    result: makeResult(docR, "Reindex", "10 EUR"),
    fileName: "r.pdf",
    extractedText: "10 EUR",
  });
  await Promise.allSettled([
    updateHistoryRecord(userId, base.id, {
      analysis: { ...base.analysis, title: "Reindex-V2", summary: "35 EUR" },
    }),
    updateHistoryRecord(userId, base.id, {
      analysis: { ...base.analysis, title: "Reindex-V3", summary: "40 EUR" },
    }),
  ]);
  const finalR = await getHistoryRecord(userId, base.id);
  assert.ok(finalR);
  const sameId = (await listHistoryRecords(userId)).filter((i) => i.id === base.id);
  assert.strictEqual(sameId.length, 1);
  assert.ok(
    finalR!.analysis.title === "Reindex-V2" ||
      finalR!.analysis.title === "Reindex-V3" ||
      finalR!.analysis.title === "Reindex",
    `titre final inattendu: ${finalR!.analysis.title}`,
  );

  // --- suppressions rapides ---
  await Promise.allSettled([
    deleteHistoryRecord(userId, rB.id),
    deleteHistoryRecord(userId, rC.id),
    deleteHistoryRecord(userId, base.id),
  ]);
  const left = await listHistoryRecords(userId);
  assert.ok(!left.some((i) => [docB, docC, docR].includes(i.documentId)));

  await rm(path.join(process.cwd(), "data", "users", userId), {
    recursive: true,
    force: true,
  });
  console.log("OK test-concurrency-fs");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
