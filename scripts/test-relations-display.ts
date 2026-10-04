/**
 * Smoke test — filtres d’affichage relations / timeline.
 * npx tsx scripts/test-relations-display.ts
 */
import {
  dedupeTimelineEventsForDisplay,
  filterRelationsForDisplay,
  normalizeRelationFileName,
  resolveRelationOtherId,
} from "../src/lib/client/relations-display";
import type { RelationListItem } from "../src/lib/client/relations";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const currentId = "doc-a";
const basePeer = {
  documentId: "doc-a",
  historyId: "h1",
  title: "mutuelle.pdf",
  fileName: "mutuelle.pdf",
  analyzedAt: null,
  category: null,
};

function item(
  partial: Partial<RelationListItem> &
    Pick<RelationListItem, "id" | "type" | "fromDocId" | "toDocId" | "peer">,
): RelationListItem {
  return {
    typeLabel: "Doublon",
    score: 0.9,
    confidenceLabel: "Élevé",
    status: "proposed",
    message: "test",
    evidence: [],
    ...partial,
  };
}

// Auto-lien même id
assert(
  resolveRelationOtherId(
    { fromDocId: currentId, toDocId: currentId, peer: basePeer },
    currentId,
  ) === null,
  "self id must be null",
);

// Lien réel
assert(
  resolveRelationOtherId(
    {
      fromDocId: currentId,
      toDocId: "doc-b",
      peer: { ...basePeer, documentId: "doc-b", fileName: "autre.pdf" },
    },
    currentId,
  ) === "doc-b",
  "other id should be doc-b",
);

const filtered = filterRelationsForDisplay(
  [
    item({
      id: "1",
      type: "duplicate_of",
      fromDocId: currentId,
      toDocId: currentId,
      peer: basePeer,
    }),
    item({
      id: "2",
      type: "duplicate_of",
      fromDocId: currentId,
      toDocId: "doc-b",
      peer: {
        ...basePeer,
        documentId: "doc-b",
        fileName: "mutuelle.pdf", // même fichier
      },
    }),
    item({
      id: "3",
      type: "party_shared",
      fromDocId: currentId,
      toDocId: "doc-c",
      peer: {
        ...basePeer,
        documentId: "doc-c",
        fileName: "autre.pdf",
        title: "Autre",
      },
    }),
    item({
      id: "4",
      type: "party_shared",
      fromDocId: "doc-c",
      toDocId: currentId,
      peer: {
        ...basePeer,
        documentId: "doc-c",
        fileName: "autre.pdf",
        title: "Autre",
      },
    }),
  ],
  currentId,
  "mutuelle.pdf",
);

assert(filtered.length === 1, `expected 1 relation, got ${filtered.length}`);
assert(filtered[0]!.id === "3", "should keep first real party_shared");
assert(
  normalizeRelationFileName("folder/Mutuelle.PDF") === "mutuelle.pdf",
  "filename normalize",
);

const timeline = dedupeTimelineEventsForDisplay([
  {
    id: "d1",
    at: "2027-12-24T12:00:00.000Z",
    kind: "deadline",
    label: "Fin de contrat",
    documentId: "doc-a",
  },
  {
    id: "d2",
    at: "2027-12-24T12:00:00.000Z",
    kind: "deadline",
    label: "Fin de contrat mutuelle",
    documentId: "doc-a",
  },
  {
    id: "doc1",
    at: "2026-08-14T10:00:00.000Z",
    kind: "document",
    label: "mutuelle.pdf",
    documentId: "doc-a",
  },
  {
    id: "doc2",
    at: "2026-08-15T10:00:00.000Z",
    kind: "document",
    label: "mutuelle.pdf",
    documentId: "doc-a",
  },
]);

const deadlines = timeline.filter((e) => e.kind === "deadline");
const docs = timeline.filter((e) => e.kind === "document");
assert(deadlines.length === 1, `deadline 2027-12-24 must be 1, got ${deadlines.length}`);
assert(docs.length === 1, `document lines must be 1, got ${docs.length}`);

console.log("OK relations-display", {
  filtered: filtered.map((r) => r.id),
  timeline: timeline.map((e) => e.id),
});
