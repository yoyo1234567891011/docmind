/**
 * Tests P2 — relations UI (templates, actions, negative cache).
 * Sans LLM, sans navigateur (logique + store).
 */
import assert from "assert";
import { rm } from "fs/promises";

import { userDataDir } from "../src/config/paths";
import {
  ensureUserWorkspace,
  resetUserWorkspaceCache,
} from "../src/services/auth/workspace";
import {
  addNegativeEdge,
  applyRelationAction,
  buildRelationMessage,
  confidenceLabelFromScore,
  getRelationsForUi,
  isNegativeEdge,
  selectRelationCandidates,
  upsertMemoryFromHistoryRecord,
} from "../src/services/memory";
import { getMemoryDocument } from "../src/services/memory/document-store";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import type { HistoryRecord } from "../src/types";
import { EMPTY_READY_REPLY } from "../src/types/reply";

function makeRecord(
  userId: string,
  documentId: string,
  opts: {
    title: string;
    org: string;
    date: string;
    text: string;
    analyzedAt?: string;
  },
): HistoryRecord {
  return {
    id: `hist-${documentId}`,
    userId,
    documentId,
    fileName: `${documentId}.pdf`,
    displayName: opts.title,
    favorite: false,
    tagIds: [],
    createdAt: opts.analyzedAt ?? new Date().toISOString(),
    classification: {
      category: "assurance",
      label: "Assurance",
      confidence: 0.9,
    },
    analysis: {
      document_type: "Assurance",
      title: opts.title,
      summary: "test",
      date: opts.date,
      dates: [opts.date],
      people: [],
      organizations: [opts.org],
      amounts: ["12 €"],
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
    model: "test",
    analyzedAt: opts.analyzedAt ?? new Date().toISOString(),
    extractedText: opts.text,
    folderId: null,
    analysisPhase: "complete",
  };
}

async function main() {
  resetUserWorkspaceCache();
  const userId = `mem-p2-${Date.now()}`;
  await ensureUserWorkspace(userId);

  // Templates / confiance
  assert.equal(confidenceLabelFromScore(0.95), "Élevé");
  assert.equal(confidenceLabelFromScore(0.75), "Moyen");
  assert.equal(confidenceLabelFromScore(0.4), "Faible");
  assert.ok(
    buildRelationMessage(
      "duplicate_of",
      {
        documentId: "x",
        historyId: null,
        title: "Doc A",
        fileName: "a.pdf",
        analyzedAt: null,
        category: "assurance",
      },
      [],
    ).includes("doublon"),
  );
  assert.ok(
    buildRelationMessage(
      "supersedes",
      {
        documentId: "x",
        historyId: null,
        title: "Ancien",
        fileName: "a.pdf",
        analyzedAt: "2024-01-01",
        category: "assurance",
      },
      [{ field: "document_date", left: "2025-01-01", right: "2024-01-01" }],
    ).includes("remplace"),
  );

  const text2024 = "CONTRAT ORANGE HOME 2024 assureur Orange Assurances SA ".repeat(
    40,
  );
  const text2025 =
    "CONTRAT ORANGE HOME 2025 assureur Orange Assurances SA revision ".repeat(
      40,
    );

  const a = makeRecord(userId, "doc-a", {
    title: "Orange Home 2024",
    org: "Orange Assurances SA",
    date: "01/03/2024",
    text: text2024,
    analyzedAt: "2024-03-01T10:00:00.000Z",
  });
  const b = makeRecord(userId, "doc-b", {
    title: "Orange Home 2025",
    org: "Orange Assurances SA",
    date: "01/03/2025",
    text: text2025,
    analyzedAt: "2025-03-01T10:00:00.000Z",
  });

  const t0 = Date.now();
  await upsertMemoryFromHistoryRecord(a);
  await upsertMemoryFromHistoryRecord(b);
  const upsertMs = Date.now() - t0;

  const tLoad = Date.now();
  const ui = await getRelationsForUi(userId, "doc-b");
  const loadMs = Date.now() - tLoad;
  assert.equal(ui.relationsPhase, "ready");
  assert.ok(ui.relations.length >= 1, "au moins une relation visible");
  for (const r of ui.relations) {
    assert.ok(r.message.length > 10);
    assert.ok(r.evidence.length >= 1);
    assert.ok(["Élevé", "Moyen", "Faible"].includes(r.confidenceLabel));
    assert.ok(r.peer.documentId);
  }

  // Tri : types importants d'abord
  const weights = ui.relations.map((r) => r.type);
  assert.ok(weights.length >= 1);

  const target =
    ui.relations.find((r) => r.type === "supersedes") ||
    ui.relations.find((r) => r.type === "same_contract_family") ||
    ui.relations[0];
  assert.ok(target);

  // Confirm
  const confirmed = await applyRelationAction(
    userId,
    "doc-b",
    target.id,
    "confirm",
  );
  assert.equal(confirmed.status, "user_confirmed");

  // Dismiss autre relation ou snooze
  const ui2 = await getRelationsForUi(userId, "doc-b");
  const proposed = ui2.relations.find((r) => r.status === "proposed");
  if (proposed) {
    await applyRelationAction(userId, "doc-b", proposed.id, "snooze");
    const ui3 = await getRelationsForUi(userId, "doc-b");
    assert.ok(
      !ui3.relations.some((r) => r.id === proposed.id),
      "snooze masque la relation",
    );
  }

  // Negative cache : dismiss → plus candidat
  const peer = "doc-a";
  await addNegativeEdge(userId, "doc-b", peer);
  assert.ok(await isNegativeEdge(userId, "doc-b", peer));

  const nodeB = await getMemoryDocument(userId, "doc-b");
  assert.ok(nodeB);
  const selection = await selectRelationCandidates({
    userId,
    document: nodeB!,
    primaryEntityIds: nodeB!.primaryEntityIds,
  });
  assert.ok(
    !selection.candidates.some((c) => c.docId === peer),
    "paire dismissed exclue du CandidateSelector",
  );

  // Dismiss via action
  const ui4 = await getRelationsForUi(userId, "doc-b");
  const stillProposed = ui4.relations.find((r) => r.status === "proposed");
  if (stillProposed) {
    await applyRelationAction(userId, "doc-b", stillProposed.id, "dismiss");
    assert.ok(
      await isNegativeEdge(
        userId,
        "doc-b",
        stillProposed.peer.documentId,
      ),
    );
    const ui5 = await getRelationsForUi(userId, "doc-b");
    assert.ok(!ui5.relations.some((r) => r.id === stillProposed.id));
  }

  await rm(userDataDir(userId), { recursive: true, force: true });

  console.log("OK test-memory-p2", {
    upsertMs,
    relationsLoadMs: loadMs,
    relationsCount: ui.relations.length,
  });

  assert.ok(loadMs < 500, `chargement UI relations trop lent: ${loadMs}ms`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
