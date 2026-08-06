/**
 * Tests fiche mémoire documentaire (sans LLM).
 */
import assert from "assert";

import {
  buildDocumentSheetFromAnalysis,
  buildSheetSearchText,
  computeSheetConfidence,
  extractSheetKeywords,
} from "../src/services/sheets";
import type { DocumentAnalysis, DocumentClassification } from "../src/types";
import { RISK_CRITERIA } from "../src/services/risk/criteria";

const classification: DocumentClassification = {
  category: "bail",
  label: "Bail",
  confidence: 0.9,
};

function analysis(): DocumentAnalysis {
  return {
    document_type: "Bail d'habitation",
    title: "Bail Dupont",
    summary: "Bail meublé avec loyer et dépôt de garantie.",
    date: "01/01/2026",
    dates: ["01/01/2026"],
    people: ["Jean Dupont"],
    organizations: ["SCI Alpha"],
    amounts: ["800 €"],
    deadlines: ["Préavis 1 mois"],
    important_points: ["Dépôt de garantie"],
    risks: ["Préavis court"],
    actions: ["Vérifier le préavis"],
    risk_score: 20,
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
    risk_findings: [
      {
        description: "Préavis court",
        why: "Le bail fixe un préavis d'un mois.",
        implication: "Le locataire peut partir rapidement.",
        consequence: "Vacance locative possible.",
        mitigation: "Anticiper le remplacement du locataire.",
        justification: "Le bail fixe un préavis d'un mois.",
        impact: "Le locataire peut partir rapidement.",
        excerpt: "préavis d'un mois",
        citation: {
          page: 1,
          paragraph: 1,
          excerpt: "préavis d'un mois",
        },
        confidence: 0.8,
        severity: "modere",
        status: "confirmed",
      },
    ],
  };
}

function main() {
  const a = analysis();
  const keywords = extractSheetKeywords(a, classification);
  assert.ok(keywords.some((k) => /dupont/i.test(k) || /bail/i.test(k)));

  const confidence = computeSheetConfidence(a, classification);
  assert.ok(confidence >= 0.5 && confidence <= 1);

  const sheet = buildDocumentSheetFromAnalysis({
    historyId: "h1",
    documentId: "d1",
    fileName: "bail.pdf",
    classification,
    analysis: a,
    analyzedAt: new Date().toISOString(),
  });

  assert.equal(sheet.type, "Bail d'habitation");
  assert.deepEqual(sheet.people, ["Jean Dupont"]);
  assert.ok(sheet.keywords.length > 0);
  assert.ok(typeof sheet.confidence === "number");

  const text = buildSheetSearchText(sheet);
  assert.ok(text.includes("Jean Dupont"));
  assert.ok(text.includes("800 €"));
  assert.ok(text.toLowerCase().includes("confiance"));

  console.log("OK test-document-memory", {
    keywords: sheet.keywords.slice(0, 8),
    confidence: sheet.confidence,
  });
}

main();
