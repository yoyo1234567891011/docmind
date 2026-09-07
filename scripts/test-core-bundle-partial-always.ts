/**
 * Garantit qu’un parse fail → bundle partiel (pas de throw) quand categoryLabel existe.
 * npx tsx --tsconfig tsconfig.json scripts/test-core-bundle-partial-always.ts
 */
import assert from "node:assert/strict";

import {
  buildDeterministicPartialCoreBundle,
  evaluateCoreBundleGeneration,
  isCoreBundleSchemaValid,
} from "../src/ai/agents/core-bundle-outcome";
import { analysisJobFailMessageFromLastError } from "../src/components/documents/analysis-job-status-copy";

function main() {
  const bank = buildDeterministicPartialCoreBundle({
    categoryLabel: "Banque",
    fileName: "releve.pdf",
    amounts: ["10,23 € — Frais de tenue"],
    deadlines: ["17/06/2026"],
  });
  assert.ok(isCoreBundleSchemaValid(bank));

  const med = buildDeterministicPartialCoreBundle({
    categoryLabel: "Mise en demeure",
    amounts: ["1 250 €"],
    deadlines: ["sous 8 jours"],
  });
  assert.ok(isCoreBundleSchemaValid(med));

  const bail = buildDeterministicPartialCoreBundle({
    categoryLabel: "Bail",
    amounts: ["850 € / mois"],
    deadlines: ["préavis 3 mois"],
  });
  assert.ok(isCoreBundleSchemaValid(bail));
  console.log("OK partial bundles banque / med / bail");

  const emptyGen = evaluateCoreBundleGeneration({
    generation: {
      text: "",
      model: "x",
      promptTokens: 100,
      completionTokens: 0,
      totalTokens: 100,
      durationMs: 800,
      finishReason: "stop",
    },
  });
  assert.equal(emptyGen.ok, false);
  if (!emptyGen.ok) {
    assert.equal(emptyGen.reason, "empty");
    // Après retries, fast-orchestrator DOIT fallback — ici on vérifie juste le diagnostic.
    assert.match(emptyGen.message, /parse_error:empty/);
  }

  const junk = evaluateCoreBundleGeneration({
    generation: {
      text: "<think>long thinking without json",
      model: "x",
      promptTokens: 10,
      completionTokens: 40,
      totalTokens: 50,
      durationMs: 100,
      finishReason: "length",
    },
  });
  assert.equal(junk.ok, false);
  if (!junk.ok) {
    assert.ok(
      junk.reason === "truncated" || junk.reason === "strip_no_object",
      junk.reason,
    );
  }
  console.log("OK empty/truncated diagnostics");

  assert.match(
    analysisJobFailMessageFromLastError("parse_error:json_parse — boom | raw={"),
    /incomplète|mal formée|invalide/i,
  );
  console.log("OK UI messages parse_error");

  console.log("\nALL partial-always tests passed.");
}

main();
