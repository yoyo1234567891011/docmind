/**
 * Régression bug prod : re-analyse crash « Cannot read properties of undefined (reading 'replace') »
 * quand un finding délais n’a pas de description (ou montants/points optionnels absents).
 *
 * npx tsx --tsconfig tsconfig.json scripts/test-reanalyze-undefined-replace.ts
 */
import assert from "node:assert/strict";

import { finalizeAnalysisForProd } from "../src/ai/post-processing/prod-quality";
import {
  classifyP2Error,
  formatP2LastError,
} from "../src/services/analysis-jobs/requeue-policy";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import type { DocumentAnalysis, DocumentClassification } from "../src/types";

const classification: DocumentClassification = {
  category: "administratif",
  label: "Impôts",
  confidence: 0.9,
};

function sparseAnalysis(): DocumentAnalysis {
  return {
    document_type: "Avis d'imposition",
    title: "Taxe foncière",
    summary: "Document Impôts.",
    date: "01/03/2026",
    dates: ["01/03/2026"],
    people: [],
    organizations: ["DGFiP"],
    amounts: ["Principal : 1 073 €", undefined as unknown as string],
    deadlines: ["Payer avant le 15/05/2026", undefined as unknown as string],
    important_points: [undefined as unknown as string, "Principal dû 1 073 €"],
    risks: [undefined as unknown as string],
    actions: [undefined as unknown as string, "Vérifier l'échéance : Payer avant le 15/05/2026"],
    risk_score: 40,
    risk_level: "modere",
    risk_explanation: "Délai de paiement.",
    risk_criteria: RISK_CRITERIA.map((c) => ({
      id: c.id,
      label: c.label,
      detected: c.id === "delais",
      score: c.id === "delais" ? 5 : 0,
      max_score: c.maxScore,
      reasons: c.id === "delais" ? ["Payer avant le 15/05/2026"] : [],
    })),
    risk_findings: [
      {
        criterion_id: "delais",
        // description absente — cause historique du crash .replace
        description: undefined as unknown as string,
        excerpt: undefined,
        confidence: 0.7,
        status: "confirmed",
      },
      {
        criterion_id: "frais_caches",
        description: "Principal : 1 073 €",
        excerpt: "Principal dû 1 073 euros",
        confidence: 0.8,
        status: "confirmed",
      },
    ],
  };
}

function main() {
  const once = finalizeAnalysisForProd(
    sparseAnalysis(),
    classification,
    "Avis de taxe foncière. Principal 1 073 €. Payer avant le 15/05/2026.",
  );
  assert.ok(Array.isArray(once.deadlines));
  assert.ok(Array.isArray(once.amounts));
  assert.ok(typeof once.summary === "string");
  assert.ok(once.summary.length > 10, "summary must be built without throw");

  // Simule « Réessayer l’analyse » : même payload sparse, 2e passage.
  const again = finalizeAnalysisForProd(
    sparseAnalysis(),
    classification,
    "Avis de taxe foncière. Principal 1 073 €. Payer avant le 15/05/2026.",
  );
  assert.ok(again.summary.length > 0);
  assert.ok(
    !(again.deadlines ?? []).some((d) => d == null),
    "deadlines must not contain null/undefined",
  );

  // buildDeterministicDisplaySummary path (summary LLM vide)
  const emptySummary = finalizeAnalysisForProd(
    { ...sparseAnalysis(), summary: "" },
    classification,
    "Avis de taxe foncière. Principal 1 073 €. Payer avant le 15/05/2026.",
  );
  assert.ok(emptySummary.summary.length > 20);

  const err = new TypeError(
    "Cannot read properties of undefined (reading 'replace')",
  );
  assert.equal(classifyP2Error(err), "runtime_error");
  const msg = formatP2LastError(
    "runtime_error",
    "fail",
    1,
    err.message,
    err,
  );
  assert.match(msg, /^runtime_error:/);
  assert.match(msg, /replace/);
  assert.doesNotMatch(msg, /^unknown:/);

  console.log("OK finalize sparse (delais sans description) ×2");
  console.log("OK last_error runtime_error lisible");
  console.log("\nALL reanalyze undefined-replace tests passed.");
}

main();
