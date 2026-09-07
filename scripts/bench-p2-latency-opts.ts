/**
 * Bench latence P2 — taille prompt + qualité locale + optionnel LLM.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/bench-p2-latency-opts.ts
 *   npx tsx --tsconfig tsconfig.json scripts/bench-p2-latency-opts.ts --live
 */
import { readFileSync, existsSync } from "fs";
import path from "path";

import { buildCoreBundlePrompt } from "../src/ai/agents/prompts/core-bundle";
import { localFacts } from "../src/ai/agents/parse-specialists";
import { classifyDocumentHeuristic } from "../src/ai/classification/heuristic";
import {
  LLM_DOCUMENT_CHAR_BUDGET,
  prepareDocumentTextForLlm,
  truncateKnowledgeForCloud,
} from "../src/ai/utils/prepare-document-text";
import { attachKnowledgeToState } from "../src/ai/agents/load-knowledge";
import { docmindConfig } from "../src/config/docmind";
import { finalizeAnalysisForProd } from "../src/ai/post-processing/prod-quality";

const DOCS = [
  {
    id: "banque",
    file: "test-documents/banques/03-releve-bancaire-banque-horizon-bqe-463739.md",
  },
  {
    id: "bail",
    file: "test-documents/baux-de-location/04-bail-location-bordeaux-bail-561304.md",
  },
  {
    id: "med",
    file: "test-documents/relances-de-paiement/01-mise-en-demeure-de-paiement-rel-681955.md",
  },
] as const;

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

async function measurePrep(id: string, file: string) {
  const abs = path.join(process.cwd(), file);
  if (!existsSync(abs)) {
    return { id, error: `missing ${file}` };
  }
  const text = readFileSync(abs, "utf8").trim();
  const facts = localFacts(text);
  const classification = classifyDocumentHeuristic(text);
  const llmText = prepareDocumentTextForLlm(text);
  const state = await attachKnowledgeToState({
    documentText: text,
    llmText,
    fileName: path.basename(file),
    model: "bench",
    tokens: { prompt: 0, completion: 0, total: 0 },
    steps: [],
    classification,
    facts,
  });
  const knowledge = truncateKnowledgeForCloud(state.knowledge?.promptBlock);
  const prompt = buildCoreBundlePrompt({
    categoryLabel: classification.label,
    documentText: llmText,
    knowledgeBlock: knowledge,
    localFacts: facts,
    compactOutput: true,
  });

  const hotFees = (facts.amounts ?? []).filter((a) =>
    /frais|commission|agios|p[ée]nal/i.test(a),
  );

  return {
    id,
    rawChars: text.length,
    llmTextChars: llmText.length,
    budget: LLM_DOCUMENT_CHAR_BUDGET,
    knowledgeChars: knowledge?.length ?? 0,
    promptChars: prompt.length,
    promptTokEst: Math.ceil(prompt.length / 3.6),
    amounts: facts.amounts?.length ?? 0,
    feeLikeAmounts: hotFees.length,
    deadlines: facts.deadlines?.length ?? 0,
    cloudMaxTokens: docmindConfig.ollama.cloudAnalyzeMaxTokens,
    cloudRetryCap: docmindConfig.ollama.cloudAnalyzeMaxTokensRetryCap,
  };
}

async function liveOne(file: string) {
  const { ensureAdminRuntimeLoaded } = await import(
    "../src/services/admin/runtime"
  );
  const { runFastMultiAgentAnalysis } = await import(
    "../src/ai/agents/fast-orchestrator"
  );
  await ensureAdminRuntimeLoaded();
  const text = readFileSync(path.join(process.cwd(), file), "utf8").trim();
  const t0 = Date.now();
  const result = await runFastMultiAgentAnalysis({
    documentText: text,
    fileName: path.basename(file),
  });
  const wallMs = Date.now() - t0;
  let analysis = result.analysis;
  analysis = finalizeAnalysisForProd(analysis, {
    documentText: text,
    fileName: path.basename(file),
  });
  const feePoints = [
    ...(analysis.important_points ?? []),
    ...((analysis as { watch?: Array<{ title?: string }> }).watch?.map(
      (w) => w.title ?? "",
    ) ?? []),
    ...(analysis.risks ?? []),
  ].filter((s) => /frais|commission|agios|p[ée]nal|€/i.test(String(s)));

  return {
    wallSec: +(wallMs / 1000).toFixed(2),
    summaryOk: Boolean(analysis.summary?.trim()),
    feeSignals: feePoints.length,
    riskScore: analysis.risk_score,
    type: analysis.document_type,
    llmStepMs:
      result.state.steps.find((s) => s.task === "risks")?.durationMs ?? null,
    tokens: result.state.tokens.total,
  };
}

async function main() {
  loadEnv();
  const live = process.argv.includes("--live");

  console.log("=== Prep / payload (déterministe) ===");
  const rows = [];
  for (const doc of DOCS) {
    if (!existsSync(path.join(process.cwd(), doc.file))) {
      // fallback med path variants
      const alt = doc.file.replace(
        "mises-en-demeure/01-mise-en-demeure-med-114630.md",
        "mises-en-demeure",
      );
      void alt;
    }
    rows.push(await measurePrep(doc.id, doc.file));
  }
  console.table(rows);

  if (!live) {
    console.log(
      "\n(Hint: ajoute --live pour chronométrer 1 run LLM si GROQ/LLM configuré)",
    );
    return;
  }

  console.log("\n=== Live LLM (banque) ===");
  const banque = DOCS[0]!;
  const liveResult = await liveOne(banque.file);
  console.log(JSON.stringify(liveResult, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
