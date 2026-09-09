/**
 * Régression : re-analyse / champs optionnels absents ne doivent plus throw.
 * Couvre finalize + scrub + letter (path P2 post-process).
 *
 * npx tsx --tsconfig tsconfig.json scripts/test-reanalyze-undefined-replace.ts
 */
import assert from "node:assert/strict";

import { finalizeAnalysisForProd } from "../src/ai/post-processing/prod-quality";
import { scrubAnalysisForDisplay } from "../src/ai/post-processing/enrich";
import { buildFallbackLetter } from "../src/services/reply/fallback-letter";
import {
  classifyP2Error,
  formatP2LastError,
} from "../src/services/analysis-jobs/requeue-policy";
import { shortenLetterSubject } from "../src/services/reply/letter-intents";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import type { DocumentAnalysis, DocumentClassification } from "../src/types";

const U = undefined as unknown as string;

const classification: DocumentClassification = {
  category: "administratif",
  label: "Impôts",
  confidence: 0.9,
};

function sparseAnalysis(): DocumentAnalysis {
  return {
    document_type: "Avis d'imposition",
    title: U,
    summary: U,
    date: U,
    dates: [U],
    people: [U],
    organizations: [U],
    amounts: ["Principal : 1 073 €", U],
    deadlines: ["Payer avant le 15/05/2026", U],
    important_points: [U, "Principal dû 1 073 €"],
    risks: [U],
    actions: [U, "Vérifier l'échéance : Payer avant le 15/05/2026"],
    risk_score: 40,
    risk_level: "modere",
    risk_explanation: U,
    risk_criteria: RISK_CRITERIA.map((c) => ({
      id: c.id,
      label: c.label,
      detected: c.id === "delais",
      score: c.id === "delais" ? 5 : 0,
      max_score: c.maxScore,
      reasons: c.id === "delais" ? [U, "Payer avant le 15/05/2026"] : [],
    })),
    risk_findings: [
      {
        criterion_id: "delais",
        description: U,
        excerpt: U,
        why: U,
        implication: U,
        confidence: 0.7,
        status: "confirmed",
      },
      {
        criterion_id: "frais_caches",
        description: "Principal : 1 073 €",
        excerpt: U,
        confidence: 0.8,
        status: "confirmed",
      },
    ],
  };
}

async function main() {
  const text =
    "Avis de taxe foncière. Principal 1 073 €. Payer avant le 15/05/2026.";

  // shortenLetterSubject(undefined) was an exact « reading 'replace' » crash.
  assert.doesNotThrow(() =>
    shortenLetterSubject(U, "contestation", "administratif"),
  );

  const scrubbed = scrubAnalysisForDisplay(sparseAnalysis());
  assert.ok(typeof scrubbed.summary === "string");

  const once = finalizeAnalysisForProd(sparseAnalysis(), classification, text);
  assert.ok(once.summary.length > 0);
  assert.ok(Array.isArray(once.deadlines));

  const again = finalizeAnalysisForProd(once, classification, text);
  assert.ok(again.summary.length > 0);

  const letter = buildFallbackLetter(
    "contestation",
    sparseAnalysis(),
    classification,
    "test",
    text,
    null,
  );
  assert.ok(letter.body.length > 20);
  assert.ok(letter.subject.length > 0);

  const letter2 = buildFallbackLetter(
    "contestation",
    again,
    classification,
    "retry",
    text,
    null,
  );
  assert.ok(letter2.body.length > 20);

  const err = new TypeError(
    "Cannot read properties of undefined (reading 'replace')",
  );
  assert.equal(classifyP2Error(err), "runtime_error");
  const msg = formatP2LastError("runtime_error", "fail", 1, err.message, err);
  assert.match(msg, /^runtime_error:/);
  assert.match(msg, /replace/);

  // stripModelNoise(undefined) was a classic reading 'replace' crash in JSON path.
  const { stripModelNoise } = await import("../src/ai/validation/json");
  assert.equal(stripModelNoise(undefined as unknown as string), "");
  assert.equal(stripModelNoise(null as unknown as string), "");

  console.log("OK shortenLetterSubject(undefined)");
  console.log("OK scrub + finalize sparse ×2 (retry)");
  console.log("OK buildFallbackLetter sparse + after finalize");
  console.log("OK last_error runtime_error");
  console.log("OK stripModelNoise(undefined)");
  console.log("\nALL reanalyze undefined-replace tests passed.");
}

void main();
