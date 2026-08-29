/**
 * Tests recherche langage naturel (heuristique + matching fiches-first).
 */
import assert from "assert";

import { parseIntentHeuristic } from "../src/services/search/heuristic";
import { matchRecordsToIntent } from "../src/services/search/match";
import { includesNormalized } from "../src/services/search/parse-values";
import { buildDocumentSheetFromAnalysis } from "../src/services/sheets";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import type {
  DocumentAnalysis,
  DocumentClassification,
  HistoryRecord,
} from "../src/types";

function baseAnalysis(
  overrides: Partial<DocumentAnalysis> = {},
): DocumentAnalysis {
  return {
    document_type: "Document",
    title: "Doc",
    summary: "Résumé",
    date: "01/01/2026",
    dates: ["01/01/2026"],
    people: [],
    organizations: [],
    amounts: [],
    deadlines: [],
    important_points: [],
    risks: [],
    actions: [],
    risk_score: 10,
    risk_level: "faible",
    risk_explanation: "test",
    risk_criteria: RISK_CRITERIA.map((c) => ({
      id: c.id,
      label: c.label,
      detected: false,
      score: 0,
      max_score: c.maxScore,
      reasons: [],
    })),
    risk_findings: [],
    ...overrides,
  };
}

function makeRecord(input: {
  id: string;
  fileName: string;
  classification: DocumentClassification;
  analysis: DocumentAnalysis;
  extractedText?: string;
}): HistoryRecord {
  const analyzedAt = "2026-03-01T10:00:00.000Z";
  const sheet = buildDocumentSheetFromAnalysis({
    historyId: input.id,
    documentId: `doc-${input.id}`,
    fileName: input.fileName,
    classification: input.classification,
    analysis: input.analysis,
    analyzedAt,
  });

  return {
    id: input.id,
    userId: "u1",
    documentId: `doc-${input.id}`,
    fileName: input.fileName,
    createdAt: analyzedAt,
    classification: input.classification,
    analysis: input.analysis,
    readyReply: {
      required: false,
      reason: "Aucune réponse nécessaire.",
      subject: "",
      body: "",
    },
    model: "test",
    analyzedAt,
    extractedText: input.extractedText ?? "",
    folderId: null,
    sheet,
  };
}

const year = new Date().getFullYear();

const records: HistoryRecord[] = [
  makeRecord({
    id: "contrat-edf",
    fileName: "contrat-edf.pdf",
    classification: {
      category: "contrat",
      label: "Contrat",
      confidence: 0.9,
    },
    analysis: baseAnalysis({
      document_type: "Contrat d'énergie",
      title: "Contrat EDF",
      organizations: ["EDF"],
      amounts: ["45 €"],
      deadlines: [`31/12/${year}`],
      summary: "Contrat de fourniture d'électricité.",
    }),
  }),
  makeRecord({
    id: "facture-edf",
    fileName: "facture-edf.pdf",
    classification: {
      category: "facture",
      label: "Facture",
      confidence: 0.9,
    },
    analysis: baseAnalysis({
      document_type: "Facture",
      title: "Facture EDF mars",
      organizations: ["EDF"],
      amounts: ["62,40 €"],
      summary: "Facture d'électricité EDF.",
    }),
  }),
  makeRecord({
    id: "abo-orange",
    fileName: "abo-orange.pdf",
    classification: {
      category: "contrat",
      label: "Contrat",
      confidence: 0.85,
    },
    analysis: baseAnalysis({
      document_type: "Abonnement mobile",
      title: "Forfait Orange",
      organizations: ["Orange"],
      amounts: ["49,99 €"],
      summary: "Abonnement mobile mensuel.",
    }),
  }),
  makeRecord({
    id: "cgv-renouvellement",
    fileName: "cgv.pdf",
    classification: {
      category: "conditions-generales",
      label: "CGV",
      confidence: 0.8,
    },
    analysis: baseAnalysis({
      document_type: "Conditions générales",
      title: "CGV service",
      summary: "Conditions générales du service.",
      important_points: ["Durée initiale 12 mois"],
    }),
    extractedText:
      "Article 8 — Renouvellement automatique. Le contrat est reconduit tacitement.",
  }),
  makeRecord({
    id: "facture-autre",
    fileName: "facture-eau.pdf",
    classification: {
      category: "autre",
      label: "Autre",
      confidence: 0.7,
    },
    analysis: baseAnalysis({
      document_type: "Facture",
      title: "Facture eau",
      organizations: ["Veolia"],
      amounts: ["22 €"],
    }),
  }),
  makeRecord({
    id: "releve-banque",
    fileName: "releve-bnp.pdf",
    classification: {
      category: "banque",
      label: "Banque",
      confidence: 0.8,
    },
    analysis: baseAnalysis({
      document_type: "Relevé de compte",
      title: "Relevé BNP mars",
      organizations: ["BNP Paribas"],
      summary: "Relevé mensuel compte courant.",
    }),
  }),
  makeRecord({
    id: "urssaf-relance",
    fileName: "relance-urssaf.pdf",
    classification: {
      category: "courrier-administratif",
      label: "Courrier administratif",
      confidence: 0.85,
    },
    analysis: baseAnalysis({
      document_type: "Mise en demeure",
      title: "Relance URSSAF cotisations",
      organizations: ["URSSAF"],
      amounts: ["1 240 €"],
      summary: "Relance pour cotisations impayées.",
      risk_level: "eleve",
      actions: [`Payer avant le 15/04/${year}`],
    }),
  }),
];

function ids(hits: { item: { id: string } }[]): string[] {
  return hits.map((hit) => hit.item.id);
}

function main() {
  const q1 = "Quels contrats expirent cette année ?";
  const i1 = parseIntentHeuristic(q1);
  assert.ok(i1.documentTypes.includes("contrat"));
  assert.equal(i1.date?.field, "deadline");
  assert.equal(i1.date?.year, year);
  const h1 = matchRecordsToIntent(records, i1);
  assert.ok(ids(h1).includes("contrat-edf"), "contrat expirant attendu");
  assert.ok(
    h1.every((hit) => hit.matchedOn === "sheet"),
    "échéances via fiches",
  );

  const q2 = "Montre toutes les factures EDF.";
  const i2 = parseIntentHeuristic(q2);
  assert.ok(i2.organizations.includes("EDF"));
  assert.ok(i2.documentTypes.includes("facture"));
  const h2 = matchRecordsToIntent(records, i2);
  assert.deepEqual(ids(h2), ["facture-edf"]);
  assert.equal(h2[0].matchedOn, "sheet");

  const q3 = "Quels abonnements dépassent 40 € ?";
  const i3 = parseIntentHeuristic(q3);
  assert.ok(i3.documentTypes.includes("abonnement"));
  assert.equal(i3.amount?.operator, "gt");
  assert.equal(i3.amount?.value, 40);
  const h3 = matchRecordsToIntent(records, i3);
  assert.ok(ids(h3).includes("abo-orange"));
  assert.ok(!ids(h3).includes("facture-autre"));
  assert.equal(h3[0].matchedOn, "sheet");

  const q4 =
    "Quels documents contiennent une clause de renouvellement automatique ?";
  const i4 = parseIntentHeuristic(q4);
  assert.ok(
    i4.keywords.some((k) => /renouvellement/i.test(k)),
    "mot-clé renouvellement",
  );
  const h4 = matchRecordsToIntent(records, i4);
  assert.ok(ids(h4).includes("cgv-renouvellement"));
  assert.equal(h4[0].matchedOn, "document", "clause absente de la fiche → doc");

  assert.equal(
    includesNormalized("Relevé BNP mars", "élevé"),
    false,
    "élevé ne doit pas matcher relevé",
  );
  assert.equal(
    includesNormalized("risque élevé sur le contrat", "élevé"),
    true,
    "élevé mot entier",
  );

  const q5 = "Mes documents à risque élevé";
  const i5 = parseIntentHeuristic(q5);
  assert.ok(
    i5.riskLevels?.includes("eleve"),
    "intent risque élevé",
  );
  const h5 = matchRecordsToIntent(records, i5);
  assert.ok(ids(h5).includes("urssaf-relance"), "relance URSSAF à risque");
  assert.ok(!ids(h5).includes("releve-banque"), "pas de faux positif relevé");

  const q6 = "Quelles factures Orange ?";
  const i6 = parseIntentHeuristic(q6);
  assert.ok(i6.organizations.includes("Orange"));
  assert.ok(i6.documentTypes.includes("facture"));
  const h6 = matchRecordsToIntent(records, i6);
  assert.ok(
    ids(h6).includes("abo-orange"),
    "fallback org seul si facture Orange absente",
  );

  const q7 = "Documents nécessitant une action";
  const i7 = parseIntentHeuristic(q7);
  assert.equal(i7.needsAction, true, "intent needsAction");
  const h7 = matchRecordsToIntent(records, i7);
  assert.ok(ids(h7).includes("urssaf-relance"), "document avec action");

  console.log("OK test-smart-search", {
    q1: ids(h1),
    q2: ids(h2),
    q3: ids(h3),
    q4: ids(h4),
    q5: ids(h5),
    q6: ids(h6),
    q7: ids(h7),
  });
}

main();
