/**
 * Tests P0 mémoire documentaire (EntityStore / RelationStore / dual-write).
 * Sans LLM, sans UX.
 */
import assert from "assert";
import { rm } from "fs/promises";

import { userDataDir } from "../src/config/paths";
import {
  ensureUserWorkspace,
  resetUserWorkspaceCache,
} from "../src/services/auth/workspace";
import {
  buildNormalizedEntityKey,
  contentHashFromText,
  inferClauseType,
  listClausesForDoc,
  listDeadlinesForDoc,
  listEntities,
  listRelationsForDoc,
  parseDateToIso,
  runMemoryDualWrite,
  upsertEntity,
  upsertMemoryFromHistoryRecord,
} from "../src/services/memory";
import { getMemoryDocument } from "../src/services/memory/document-store";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import type { HistoryRecord } from "../src/types";
import { EMPTY_READY_REPLY } from "../src/types/reply";

function makeRecord(
  userId: string,
  documentId: string,
  overrides?: Partial<HistoryRecord>,
): HistoryRecord {
  return {
    id: `hist-${documentId}`,
    userId,
    documentId,
    fileName: `${documentId}.pdf`,
    displayName: null,
    favorite: false,
    tagIds: [],
    createdAt: new Date().toISOString(),
    classification: {
      category: "bail",
      label: "Bail",
      confidence: 0.9,
    },
    analysis: {
      document_type: "Bail",
      title: "Bail test",
      summary: "Bail avec préavis.",
      date: "01/01/2026",
      dates: ["01/01/2026"],
      people: ["Jean Dupont"],
      organizations: ["SCI Alpha Habitat"],
      amounts: ["800 €"],
      deadlines: ["Préavis de résiliation avant le 01/06/2026"],
      important_points: ["Préavis d'un mois", "Franchise non applicable"],
      risks: ["Clause de tacite reconduction"],
      actions: [],
      risk_score: 20,
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
    analyzedAt: new Date().toISOString(),
    extractedText:
      "Bail SCI Alpha Habitat. Locataire Jean Dupont. Préavis d'un mois. Tacite reconduction.",
    folderId: null,
    analysisPhase: "complete",
    ...overrides,
  };
}

async function main() {
  resetUserWorkspaceCache();
  const userId = `mem-p0-${Date.now()}`;
  await ensureUserWorkspace(userId);

  // Normalize
  assert.equal(parseDateToIso("01/06/2026"), "2026-06-01");
  assert.equal(inferClauseType("Préavis d'un mois"), "preavis");
  assert.equal(
    buildNormalizedEntityKey("SCI Alpha Habitat"),
    buildNormalizedEntityKey("sci alpha habitat"),
  );
  assert.ok(contentHashFromText("abc").length === 64);

  // Entity resolver merge
  const e1 = await upsertEntity(userId, {
    kind: "organization",
    name: "SCI Alpha Habitat",
    docId: "doc-a",
    roleHints: ["bailleur"],
  });
  const e2 = await upsertEntity(userId, {
    kind: "organization",
    name: "SCI Alpha Habitat",
    docId: "doc-b",
  });
  assert.equal(e1.id, e2.id, "même org → même entity id");
  assert.ok(e2.docIds.includes("doc-a") && e2.docIds.includes("doc-b"));

  // Upsert from history
  const recA = makeRecord(userId, "doc-mem-a");
  const t0 = Date.now();
  const result = await upsertMemoryFromHistoryRecord(recA);
  const duration = Date.now() - t0;
  assert.ok(result.entities.length >= 2, "person + org");
  assert.ok(result.deadlines.length >= 1);
  assert.ok(result.clauses.length >= 1, "clauses first-class");
  assert.equal(result.document.relationsPhase, "ready");
  assert.ok(duration < 2000, `budget large test env (${duration}ms)`);

  const entities = await listEntities(userId);
  assert.ok(entities.some((e) => e.kind === "organization"));
  assert.ok((await listClausesForDoc(userId, "doc-mem-a")).length >= 1);
  assert.ok((await listDeadlinesForDoc(userId, "doc-mem-a")).length >= 1);

  // Second doc (texte différent, même org) → family / party_shared via P1 engine
  const recB = makeRecord(userId, "doc-mem-b", {
    analysis: {
      ...recA.analysis,
      title: "Bail Martin 2026",
      date: "01/06/2026",
      people: ["Marie Martin"],
      organizations: ["SCI Alpha Habitat"],
      deadlines: ["Paiement loyer avant le 05/07/2026"],
    },
    extractedText:
      "Bail SCI Alpha Habitat. Locataire Marie Martin. Loyer 850 EUR. Préavis deux mois. Date 01/06/2026.",
  });
  const resultB = await upsertMemoryFromHistoryRecord(recB);
  assert.ok(resultB.relationsCreated >= 1, "relation cross-doc attendue");
  const rels = await listRelationsForDoc(userId, "doc-mem-b");
  assert.ok(
    rels.some(
      (r) =>
        (r.type === "party_shared" ||
          r.type === "same_contract_family" ||
          r.type === "supersedes" ||
          r.type === "duplicate_of") &&
        r.evidence.length >= 1,
    ),
    "lien typé avec evidence attendu",
  );
  if (resultB.relationMetrics) {
    assert.ok(resultB.relationMetrics.candidateCount <= 20);
  }

  // Dual-write sync
  await runMemoryDualWrite(recA);
  const memDoc = await getMemoryDocument(userId, "doc-mem-a");
  assert.ok(memDoc);
  assert.equal(memDoc?.relationsPhase, "ready");

  // Idempotence entity count for same org
  const orgs = (await listEntities(userId)).filter(
    (e) => e.kind === "organization" && /alpha/i.test(e.canonicalName),
  );
  assert.equal(orgs.length, 1, "une seule entité org Alpha");

  // Preview ne doit pas polluer si on filtre côté dual-write — upsert direct ok
  // Cleanup
  await rm(userDataDir(userId), { recursive: true, force: true });

  console.log("OK test-memory-p0", {
    durationMs: result.durationMs,
    entities: result.entities.length,
    clauses: result.clauses.length,
    deadlines: result.deadlines.length,
    relationsCreated: resultB.relationsCreated,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
