/**
 * Tests utilitaires du gestionnaire de documents (sans réseau).
 */
import assert from "assert";

import {
  buildManagerQuery,
  managerBreadcrumbLabel,
} from "../src/components/documents/manager/build-query";
import { mapRecordToListItem } from "../src/components/documents/manager/map-record";
import { UNFILED_FOLDER_ID } from "../src/types";
import type { HistoryRecord } from "../src/types";
import { RISK_CRITERIA } from "../src/services/risk/criteria";

function main() {
  const q1 = buildManagerQuery(
    { type: "favorites" },
    {
      search: "edf",
      category: "facture",
      riskLevel: "eleve",
      sortBy: "title",
      sortDir: "asc",
    },
  );
  assert.equal(q1.favoritesOnly, true);
  assert.equal(q1.search, "edf");
  assert.equal(q1.category, "facture");
  assert.equal(q1.riskLevel, "eleve");
  assert.equal(q1.sortBy, "title");

  const q2 = buildManagerQuery(
    { type: "folder", id: UNFILED_FOLDER_ID },
    {
      search: "",
      category: "all",
      riskLevel: "all",
      sortBy: "analyzedAt",
      sortDir: "desc",
    },
  );
  assert.equal(q2.folderId, UNFILED_FOLDER_ID);

  const label = managerBreadcrumbLabel(
    { type: "tag", id: "t1" },
    [],
    [{ id: "t1", name: "Urgent" }],
  );
  assert.equal(label, "#Urgent");

  const record = {
    id: "h1",
    userId: "u1",
    documentId: "d1",
    fileName: "doc.pdf",
    displayName: "Mon contrat",
    favorite: true,
    tagIds: ["t1"],
    createdAt: "2026-01-01T00:00:00.000Z",
    classification: {
      category: "contrat",
      label: "Contrat",
      confidence: 0.9,
    },
    analysis: {
      document_type: "Contrat",
      title: "Titre analyse",
      summary: "",
      date: "",
      dates: [],
      people: [],
      organizations: [],
      amounts: [],
      deadlines: [],
      important_points: [],
      risks: [],
      actions: ["Agir"],
      risk_score: 40,
      risk_level: "modere",
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
    readyReply: {
      required: false,
      reason: "",
      subject: "",
      body: "",
    },
    model: "test",
    analyzedAt: "2026-01-02T00:00:00.000Z",
    extractedText: "",
    folderId: null,
  } as HistoryRecord;

  const item = mapRecordToListItem(record);
  assert.equal(item.title, "Mon contrat");
  assert.equal(item.favorite, true);
  assert.deepEqual(item.tagIds, ["t1"]);
  assert.equal(item.riskLevel, "modere");

  console.log("OK test-document-manager", { q1: q1.favoritesOnly, label });
}

main();
