/**
 * Parse JSON modèle + fallback partiel core-bundle.
 * npx tsx --tsconfig tsconfig.json scripts/test-core-bundle-json-parse.ts
 */
import assert from "node:assert/strict";

import {
  diagnoseJsonParseFailure,
  parseJsonObject,
  stripModelNoise,
  tryParseJsonObject,
} from "../src/ai/validation/json";
import {
  buildDeterministicPartialCoreBundle,
  evaluateCoreBundleGeneration,
  isCoreBundleSchemaValid,
} from "../src/ai/agents/core-bundle-outcome";
import { formatP2LastError } from "../src/services/analysis-jobs/requeue-policy";

function main() {
  const withThink = `<think>je réfléchis longuement</think>
\`\`\`json
{"document_type":"Bail","title":"Bail","summary":"Loyer 800 €.","risks":["Loyer 800 €"],"actions":["Vérifier le loyer"]}
\`\`\``;
  const stripped = stripModelNoise(withThink);
  assert.ok(!stripped.includes("<think>"));
  const parsed = parseJsonObject<{ summary: string }>(withThink);
  assert.match(parsed.summary, /800/);
  console.log("OK strip <think> + parse JSON");

  const unclosedThink = `<think>encore en train${"x".repeat(200)}
{"summary":"ok","risks":["a"],"actions":["b"]}`;
  assert.ok(tryParseJsonObject(unclosedThink));
  console.log("OK think non fermé strip + parse");

  const truncated = `{"summary":"Doc banque — frais 10,23 €","risks":["frais","`;
  const repaired = tryParseJsonObject<{ summary: string }>(truncated);
  assert.ok(repaired, "truncated JSON should repair");
  assert.match(repaired!.summary ?? "", /frais|Doc/i);
  console.log("OK truncated JSON repair");

  assert.equal(diagnoseJsonParseFailure(""), "empty");
  assert.equal(diagnoseJsonParseFailure("hello no braces"), "strip_no_object");
  console.log("OK diagnose reasons");

  const emptyEval = evaluateCoreBundleGeneration({
    generation: {
      text: "",
      model: "x",
      promptTokens: 1,
      completionTokens: 0,
      totalTokens: 1,
      durationMs: 10,
      finishReason: "stop",
    },
  });
  assert.equal(emptyEval.ok, false);
  if (!emptyEval.ok) {
    assert.equal(emptyEval.reason, "empty");
    assert.match(emptyEval.message, /^parse_error:empty/);
  }

  const junkEval = evaluateCoreBundleGeneration({
    generation: {
      text: "Je ne peux pas répondre en JSON.",
      model: "x",
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      durationMs: 20,
      finishReason: "stop",
    },
  });
  assert.equal(junkEval.ok, false);
  if (!junkEval.ok) {
    assert.equal(junkEval.reason, "strip_no_object");
    assert.match(junkEval.message, /^parse_error:strip_no_object/);
  }
  console.log("OK evaluateCoreBundleGeneration reasons");

  const partial = buildDeterministicPartialCoreBundle({
    categoryLabel: "Banque",
    fileName: "releve.pdf",
    amounts: ["10,23 € — Frais"],
    deadlines: ["17/06/2026"],
  });
  assert.ok(isCoreBundleSchemaValid(partial));
  assert.match(String(partial.summary), /10,23|Banque|Éléments|Document/i);
  console.log("OK deterministic partial bundle");

  const failMsg = formatP2LastError(
    "parse_error",
    "fail",
    1,
    "parse_error:json_parse — JSON d'analyse invalide ou tronqué.",
  );
  assert.equal(
    failMsg,
    "parse_error:json_parse — JSON d'analyse invalide ou tronqué.",
  );
  console.log("OK last_error conserve la raison brute");

  console.log("\nALL core-bundle-json-parse tests passed.");
}

main();
