/**
 * Benchmark pipeline analyse : P1, préparation, LLM, parsing, total.
 * Usage: npx tsx --tsconfig tsconfig.json scripts/bench-llm-pipeline.ts [--label before|after]
 */
// @ts-nocheck
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

import { runFastMultiAgentAnalysis } from "../src/ai/agents/fast-orchestrator";
import { buildCoreBundlePrompt } from "../src/ai/agents/prompts/core-bundle";
import { localFacts } from "../src/ai/agents/parse-specialists";
import { classifyDocumentHeuristic } from "../src/ai/classification/heuristic";
import { quickAnalyzeDocumentText } from "../src/ai/pipelines/quick-analyze";
import {
  LLM_DOCUMENT_CHAR_BUDGET,
  prepareDocumentTextForLlm,
} from "../src/ai/utils/prepare-document-text";
import { attachKnowledgeToState } from "../src/ai/agents/load-knowledge";
import { resolveTaskConfig } from "../src/services/admin/config-store";
import { ensureAdminRuntimeLoaded } from "../src/services/admin/runtime";

const ROOT = process.cwd();

const DOCS = [
  {
    id: "facture",
    file: "test-documents/factures-edf/02-facture-electricite-edf-465605.md",
    fileName: "facture-edf.md",
  },
  {
    id: "bail",
    file: "test-documents/baux-de-location/04-bail-location-bordeaux-bail-561304.md",
    fileName: "bail-bordeaux.md",
  },
  {
    id: "admin",
    file: "test-documents/courriers-administratifs/01-courrier-administratif-adm-114630.md",
    fileName: "courrier-admin.md",
  },
  {
    id: "long",
    file: "test-documents/conditions-generales-de-vente/04-cgv-boutique-nordik-cgv-502347.md",
    fileName: "cgv-long.md",
  },
] as const;

function loadEnvFile(content: string) {
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

async function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    try {
      loadEnvFile(await readFile(path.join(ROOT, name), "utf8"));
    } catch {
      /* optional */
    }
  }
}

function estTokens(chars: number): number {
  return Math.ceil(chars / 3.6);
}

async function benchDoc(doc: (typeof DOCS)[number]) {
  const raw = await readFile(path.join(ROOT, doc.file), "utf8");
  const text = raw.trim();

  const p1Started = Date.now();
  await quickAnalyzeDocumentText({
    userId: "bench",
    documentId: `bench-${doc.id}`,
    text,
    fileName: doc.fileName,
    skipReadyReply: true,
  });
  const p1Ms = Date.now() - p1Started;

  const prepStarted = Date.now();
  const facts = localFacts(text);
  const classification = classifyDocumentHeuristic(text);
  const llmText = prepareDocumentTextForLlm(text);
  const baseState = {
    documentText: text,
    llmText,
    fileName: doc.fileName,
    model: (await resolveTaskConfig("analyze")).model,
    tokens: { prompt: 0, completion: 0, total: 0 },
    steps: [] as import("../src/ai/agents/types").AgentPipelineState["steps"],
    classification,
    facts,
  };
  const state = await attachKnowledgeToState(
    baseState as import("../src/ai/agents/types").AgentPipelineState,
  );
  const prompt = buildCoreBundlePrompt({
    categoryLabel: classification.label,
    documentText: llmText,
    knowledgeBlock: state.knowledge?.promptBlock,
    localFacts: facts,
  });
  const prepMs = Date.now() - prepStarted;

  const llmStarted = Date.now();
  const multi = await runFastMultiAgentAnalysis({
    documentText: text,
    fileName: doc.fileName,
  });
  const llmWallMs = Date.now() - llmStarted;

  const risksStep = multi.state.steps.find((s) => s.task === "risks");
  const generateMs = risksStep?.durationMs ?? 0;
  const verifyStep = multi.state.steps.find((s) => s.task === "verify");
  const scoreStep = multi.state.steps.find((s) => s.task === "score");
  const parseMs =
    (verifyStep?.durationMs ?? 0) + (scoreStep?.durationMs ?? 0);

  const tokens = multi.state.tokens;
  const analysis = multi.analysis;

  return {
    id: doc.id,
    file: doc.file,
    textChars: text.length,
    llmTextChars: llmText.length,
    llmBudget: LLM_DOCUMENT_CHAR_BUDGET,
    promptChars: prompt.length,
    estPromptTokens: estTokens(prompt.length),
    timings: {
      p1Ms,
      prepMs,
      llmGenerateMs: generateMs,
      llmWallMs,
      parseMs,
      totalMs: p1Ms + llmWallMs,
    },
    tokens: {
      prompt: tokens.prompt,
      completion: tokens.completion,
      total: tokens.total,
    },
    quality: {
      documentType: analysis.document_type,
      amounts: analysis.amounts.slice(0, 5),
      dates: analysis.dates.slice(0, 3),
      deadlines: analysis.deadlines.slice(0, 3),
      people: analysis.people.slice(0, 3),
      organizations: analysis.organizations.slice(0, 3),
      risksCount: analysis.risks.length,
      findingsCount: analysis.risk_findings?.length ?? 0,
      actionsCount: analysis.actions.length,
      summaryLen: analysis.summary.length,
      riskScore: analysis.risk_score,
      jsonValid: Boolean(analysis.summary && analysis.title),
    },
    model: multi.state.model,
    llmCalls: multi.state.steps.filter(
      (s) => s.generation && (s.generation.totalTokens ?? 0) > 0,
    ).length,
  };
}

async function main() {
  await loadEnv();
  await ensureAdminRuntimeLoaded();

  const label =
    process.argv.find((a) => a.startsWith("--label="))?.split("=")[1] ??
    process.argv[process.argv.indexOf("--label") + 1] ??
    "run";
  const prepOnly =
    process.argv.includes("--prep-only") ||
    process.argv.includes("--prepOnly");

  const model = (await resolveTaskConfig("analyze")).model;
  console.log(`[bench-llm] label=${label} model=${model} prepOnly=${prepOnly}\n`);

  const results = [];
  for (const doc of DOCS) {
    console.log(`→ ${doc.id}…`);
    try {
      if (prepOnly) {
        const raw = await readFile(path.join(ROOT, doc.file), "utf8");
        const text = raw.trim();
        const p1Started = Date.now();
        await quickAnalyzeDocumentText({
          userId: "bench",
          documentId: `bench-${doc.id}`,
          text,
          fileName: doc.fileName,
          skipReadyReply: true,
        });
        const p1Ms = Date.now() - p1Started;
        const prepStarted = Date.now();
        const facts = localFacts(text);
        const classification = classifyDocumentHeuristic(text);
        const llmText = prepareDocumentTextForLlm(text);
        let state = {
          documentText: text,
          llmText,
          fileName: doc.fileName,
          model,
          tokens: { prompt: 0, completion: 0, total: 0 },
          steps: [] as unknown[],
          classification,
          facts,
        };
        state = await attachKnowledgeToState(state as import("../src/ai/agents/types").AgentPipelineState);
        const prompt = buildCoreBundlePrompt({
          categoryLabel: classification.label,
          documentText: llmText,
          knowledgeBlock: state.knowledge?.promptBlock,
          localFacts: facts,
        });
        const prepMs = Date.now() - prepStarted;
        results.push({
          id: doc.id,
          textChars: text.length,
          llmTextChars: llmText.length,
          promptChars: prompt.length,
          knowledgeChars: state.knowledge?.promptBlock?.length ?? 0,
          estPromptTokens: estTokens(prompt.length),
          timings: { p1Ms, prepMs },
        });
        console.log(
          `  P1=${p1Ms}ms prep=${prepMs}ms prompt=${prompt.length} tok≈${estTokens(prompt.length)} doc=${llmText.length} know=${state.knowledge?.promptBlock?.length ?? 0}`,
        );
        continue;
      }
      const row = await benchDoc(doc);
      results.push(row);
      console.log(
        `  P1=${row.timings.p1Ms}ms prep=${row.timings.prepMs}ms LLM=${row.timings.llmGenerateMs}ms total=${row.timings.totalMs}ms tok=${row.tokens.total} prompt≈${row.estPromptTokens}`,
      );
    } catch (error) {
      console.error(`  FAIL ${doc.id}:`, error instanceof Error ? error.message : error);
      results.push({ id: doc.id, error: String(error) });
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }

  const ok = results.filter(
    (r): r is Awaited<ReturnType<typeof benchDoc>> =>
      "timings" in r && "tokens" in r,
  );
  const prepRows = results.filter(
    (r): r is {
      id: string;
      estPromptTokens: number;
      promptChars: number;
      timings: { p1Ms: number; prepMs: number };
    } => "estPromptTokens" in r && !("tokens" in r),
  );
  const report = {
    label,
    at: new Date().toISOString(),
    model,
    llmDocumentCharBudget: LLM_DOCUMENT_CHAR_BUDGET,
    results,
    summary: {
      avgTotalMs:
        ok.length > 0
          ? Math.round(ok.reduce((s, r) => s + r.timings.totalMs, 0) / ok.length)
          : null,
      avgLlmMs:
        ok.length > 0
          ? Math.round(
              ok.reduce((s, r) => s + r.timings.llmGenerateMs, 0) / ok.length,
            )
          : null,
      avgTokens:
        ok.length > 0
          ? Math.round(ok.reduce((s, r) => s + r.tokens.total, 0) / ok.length)
          : null,
      avgPromptTokens:
        ok.length > 0
          ? Math.round(
              ok.reduce((s, r) => s + r.estPromptTokens, 0) / ok.length,
            )
          : null,
      avgPromptChars:
        prepRows.length > 0
          ? Math.round(
              prepRows.reduce((s, r) => s + r.promptChars, 0) / prepRows.length,
            )
          : ok.length > 0
            ? Math.round(
                ok.reduce((s, r) => s + r.promptChars, 0) / ok.length,
              )
            : null,
      avgPrepMs:
        prepRows.length > 0
          ? Math.round(
              prepRows.reduce((s, r) => s + r.timings.prepMs, 0) /
                prepRows.length,
            )
          : null,
    },
  };

  await mkdir(path.join(ROOT, "reports"), { recursive: true });
  const out = path.join(ROOT, "reports", `llm-perf-${label}.json`);
  await writeFile(out, JSON.stringify(report, null, 2), "utf8");
  console.log(`\n[bench-llm] saved ${out}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
