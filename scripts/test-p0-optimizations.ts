/**
 * Tests de non-régression des modules P0 (sans LLM métier / sans prompts).
 */
import assert from "assert";

import {
  ANALYSIS_PIPELINE_VERSION,
  countLocalSignals,
  getCachedAnalysis,
  hashDocumentText,
  resolveOllamaKeepAlive,
  setCachedAnalysis,
  shouldRetryJsonAnalysis,
  type CacheFingerprint,
} from "../src/ai/optimizations";
import { EMPTY_READY_REPLY } from "../src/types/reply";
import type { DocumentAnalysis, DocumentClassification } from "../src/types";

const TEST_FP: CacheFingerprint = {
  model: "mistral",
  promptsFingerprint: "test-prompts",
  pipelineVersion: ANALYSIS_PIPELINE_VERSION,
};

const RICH = `
Facture 99 €
Échéance 01/01/2027
Date du document 15/12/2026
`;

function analysis(): DocumentAnalysis {
  return {
    document_type: "Facture",
    title: "T",
    summary: "S",
    date: "15/12/2026",
    dates: ["15/12/2026"],
    people: [],
    organizations: [],
    amounts: ["99 €"],
    deadlines: ["01/01/2027"],
    important_points: [],
    risks: [],
    actions: [],
    risk_score: 0,
    risk_level: "faible",
    risk_explanation: "",
    risk_criteria: [],
  };
}

const classification: DocumentClassification = {
  category: "facture",
  label: "Facture",
  confidence: 1,
};

async function withEnv(
  env: Record<string, string>,
  fn: () => Promise<void>,
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function main() {
  assert.equal(hashDocumentText("a").length, 64);
  assert.notEqual(hashDocumentText("a"), hashDocumentText("b"));

  await withEnv(
    {
      OPT_ANALYSIS_CACHE: "1",
      OPT_CONDITIONAL_JSON_RETRY: "1",
      OPT_OLLAMA_KEEP_ALIVE: "1",
    },
    async () => {
      const text = `unique-${Date.now()}-${Math.random()}\n${RICH}`;
      const userId = "test-user-cache";
      await setCachedAnalysis({
        userId,
        text,
        fingerprint: TEST_FP,
        model: "mistral",
        classification,
        analysis: analysis(),
        readyReply: EMPTY_READY_REPLY,
      });
      const hit = await getCachedAnalysis(userId, text, TEST_FP);
      assert.ok(hit, "cache hit attendu");
      assert.equal(hit.analysis.title, "T");

      assert.ok(countLocalSignals(RICH) >= 2);
      assert.equal(
        shouldRetryJsonAnalysis({
          firstGenerationOk: true,
          parsedOk: false,
          documentText: RICH,
        }),
        false,
        "retry skip si signaux locaux",
      );
      assert.equal(
        shouldRetryJsonAnalysis({
          firstGenerationOk: true,
          parsedOk: true,
          documentText: RICH,
        }),
        false,
      );
      assert.equal(
        shouldRetryJsonAnalysis({
          firstGenerationOk: true,
          parsedOk: false,
          documentText: "texte sans rien",
        }),
        true,
        "retry si pauvre",
      );

      assert.equal(resolveOllamaKeepAlive(), "30m");
    },
  );

  await withEnv(
    {
      OPT_ANALYSIS_CACHE: "0",
      OPT_CONDITIONAL_JSON_RETRY: "0",
      OPT_OLLAMA_KEEP_ALIVE: "0",
    },
    async () => {
      const text = `off-${Date.now()}`;
      const userId = "test-user-cache-off";
      await setCachedAnalysis({
        userId,
        text,
        fingerprint: TEST_FP,
        model: "mistral",
        classification,
        analysis: analysis(),
        readyReply: EMPTY_READY_REPLY,
      });
      assert.equal(
        await getCachedAnalysis(userId, text, TEST_FP),
        null,
        "cache OFF → miss",
      );
      assert.equal(
        shouldRetryJsonAnalysis({
          firstGenerationOk: true,
          parsedOk: false,
          documentText: RICH,
        }),
        true,
        "retry OFF → toujours retenter",
      );
      assert.equal(resolveOllamaKeepAlive(), undefined);
    },
  );

  console.log("OK — tests P0 optimizations");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
