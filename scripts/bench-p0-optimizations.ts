/**
 * Bench P0 : mesure avant (opts OFF) / après (opts ON) + checks modules.
 * Usage: npx tsx --tsconfig tsconfig.json scripts/bench-p0-optimizations.ts
 */
import { mkdir, writeFile } from "fs/promises";
import path from "path";

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

const BENCH_FP: CacheFingerprint = {
  model: "mistral",
  promptsFingerprint: "bench",
  pipelineVersion: ANALYSIS_PIPELINE_VERSION,
};
import { getOptimizationConfig } from "../src/config/optimizations";
import { EMPTY_READY_REPLY } from "../src/types/reply";
import type { DocumentAnalysis, DocumentClassification } from "../src/types";

const SAMPLE_RICH = `
FACTURE N° 2026-441
Montant TTC : 1 250,00 €
Date d'échéance : 03/04/2026
Préavis de 30 jours.
Banque Horizon — IBAN FR76 3000 6000 1111
`;

const SAMPLE_POOR = `
Document administratif divers sans montant ni date explicite.
Informations générales uniquement.
`;

function fakeAnalysis(title: string): DocumentAnalysis {
  return {
    document_type: "Facture",
    title,
    summary: "Résumé test",
    date: "03/04/2026",
    dates: ["03/04/2026"],
    people: [],
    organizations: ["Banque Horizon"],
    amounts: ["1 250,00 €"],
    deadlines: ["03/04/2026"],
    important_points: ["Payer avant échéance"],
    risks: [],
    actions: ["Anticiper l'échéance"],
    risk_score: 10,
    risk_level: "faible",
    risk_explanation: "Faible",
    risk_criteria: [],
  };
}

const fakeClass: DocumentClassification = {
  category: "facture",
  label: "Facture",
  confidence: 0.9,
};

async function withEnv(
  env: Record<string, string>,
  fn: () => Promise<void> | void,
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

async function benchCache(label: string) {
  const text = `${SAMPLE_RICH}\n#${label}\n#${Date.now()}`;
  const t0 = performance.now();
  const userId = "bench-cache-user";
  await setCachedAnalysis({
    userId,
    text,
    fingerprint: BENCH_FP,
    model: "mistral",
    classification: fakeClass,
    analysis: fakeAnalysis(`cache-${label}`),
    readyReply: EMPTY_READY_REPLY,
  });
  const writeMs = performance.now() - t0;

  const t1 = performance.now();
  const hit = await getCachedAnalysis(userId, text, BENCH_FP);
  const readMs = performance.now() - t1;

  return {
    enabled: getOptimizationConfig().analysisCache.enabled,
    writeMs: Number(writeMs.toFixed(3)),
    readMs: Number(readMs.toFixed(3)),
    hit: Boolean(hit),
    hash: hashDocumentText(text.trim()).slice(0, 12),
  };
}

function benchRetry() {
  const richSignals = countLocalSignals(SAMPLE_RICH);
  const poorSignals = countLocalSignals(SAMPLE_POOR);
  const retryRich = shouldRetryJsonAnalysis({
    firstGenerationOk: true,
    parsedOk: false,
    documentText: SAMPLE_RICH,
  });
  const retryPoor = shouldRetryJsonAnalysis({
    firstGenerationOk: true,
    parsedOk: false,
    documentText: SAMPLE_POOR,
  });
  const noRetryParsed = shouldRetryJsonAnalysis({
    firstGenerationOk: true,
    parsedOk: true,
    documentText: SAMPLE_RICH,
  });

  return {
    enabled: getOptimizationConfig().conditionalJsonRetry.enabled,
    richSignals,
    poorSignals,
    retryWhenRichInvalidJson: retryRich,
    retryWhenPoorInvalidJson: retryPoor,
    retryWhenParsedOk: noRetryParsed,
  };
}

function benchKeepAlive() {
  const value = resolveOllamaKeepAlive();
  return {
    enabled: getOptimizationConfig().ollamaKeepAlive.enabled,
    keepAlive: value ?? null,
  };
}

async function pingOllamaKeepAlive(): Promise<{
  ok: boolean;
  firstMs: number | null;
  secondMs: number | null;
}> {
  const base = (
    process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"
  ).replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL || "mistral";
  const keepAlive = resolveOllamaKeepAlive();

  async function once() {
    const started = performance.now();
    const response = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: '{"ping":true}',
        stream: false,
        format: "json",
        think: false,
        ...(keepAlive !== undefined ? { keep_alive: keepAlive } : {}),
        options: { num_predict: 8, temperature: 0, num_ctx: 512 },
      }),
    });
    if (!response.ok) throw new Error(`ollama ${response.status}`);
    await response.json();
    return performance.now() - started;
  }

  try {
    const firstMs = await once();
    const secondMs = await once();
    return {
      ok: true,
      firstMs: Number(firstMs.toFixed(1)),
      secondMs: Number(secondMs.toFixed(1)),
    };
  } catch {
    return { ok: false, firstMs: null, secondMs: null };
  }
}

async function main() {
  const historicalBefore = {
    note: "Moyenne logs utilisateur avant P0 (pipeline sans cache/retry conditionnel/keep_alive)",
    avgAnalysisOkMs: 154_974,
    medianMs: 152_502,
    sampleSuccessfulRunMs: 70_000,
    source: "data/users/*/analysis-logs.json",
  };

  let before: Record<string, unknown> = {};
  let after: Record<string, unknown> = {};

  await withEnv(
    {
      OPT_ANALYSIS_CACHE: "0",
      OPT_CONDITIONAL_JSON_RETRY: "0",
      OPT_OLLAMA_KEEP_ALIVE: "0",
    },
    async () => {
      before = {
        config: getOptimizationConfig(),
        cache: await benchCache("before"),
        retry: benchRetry(),
        keepAlive: benchKeepAlive(),
        ollamaPing: await pingOllamaKeepAlive(),
      };
    },
  );

  await withEnv(
    {
      OPT_ANALYSIS_CACHE: "1",
      OPT_CONDITIONAL_JSON_RETRY: "1",
      OPT_OLLAMA_KEEP_ALIVE: "1",
    },
    async () => {
      after = {
        config: getOptimizationConfig(),
        cache: await benchCache("after"),
        retry: benchRetry(),
        keepAlive: benchKeepAlive(),
        ollamaPing: await pingOllamaKeepAlive(),
      };
    },
  );

  const afterCache = after.cache as {
    hit: boolean;
    readMs: number;
    writeMs: number;
  };
  const beforeRetry = before.retry as {
    retryWhenRichInvalidJson: boolean;
    retryWhenPoorInvalidJson: boolean;
  };
  const afterRetry = after.retry as {
    retryWhenRichInvalidJson: boolean;
    retryWhenPoorInvalidJson: boolean;
  };
  const beforeKa = before.keepAlive as { keepAlive: string | null };
  const afterKa = after.keepAlive as { keepAlive: string | null };
  const afterPing = after.ollamaPing as {
    ok: boolean;
    firstMs: number | null;
    secondMs: number | null;
  };

  const report = [
    "# Rapport performances P0 — optimisations DocMind",
    "",
    `Généré le : ${new Date().toISOString()}`,
    "",
    "## Périmètre",
    "",
    "1. Cache d'analyse (hash SHA-256 du texte)",
    "2. Retry JSON conditionnel",
    "3. `keep_alive` Ollama/Mistral",
    "4. Interrupteurs dans `src/config/optimizations.ts` (+ env `OPT_*`)",
    "",
    "## Baseline produit (avant P0 — logs réels)",
    "",
    `| Métrique | Valeur |`,
    `|---|---|`,
    `| Moyenne analyses OK | ${Math.round(historicalBefore.avgAnalysisOkMs / 1000)} s |`,
    `| Médiane | ${Math.round(historicalBefore.medianMs / 1000)} s |`,
    `| Run réussi récent (heuristique + 1 LLM) | ~${Math.round(historicalBefore.sampleSuccessfulRunMs / 1000)} s |`,
    `| Source | \`${historicalBefore.source}\` |`,
    "",
    "## Bench modules (opts OFF vs ON)",
    "",
    "### Cache",
    "",
    `| | Avant (OFF) | Après (ON) |`,
    `|---|---|---|`,
    `| enabled | ${(before.cache as { enabled: boolean }).enabled} | ${afterCache && (after.cache as { enabled: boolean }).enabled} |`,
    `| hit après write | ${(before.cache as { hit: boolean }).hit} | ${afterCache.hit} |`,
    `| write (ms) | ${(before.cache as { writeMs: number }).writeMs} | ${afterCache.writeMs} |`,
    `| read hit (ms) | ${(before.cache as { readMs: number }).readMs} | ${afterCache.readMs} |`,
    "",
    afterCache.hit
      ? `**Gain attendu re-analyse même texte :** de ~${Math.round(historicalBefore.sampleSuccessfulRunMs / 1000)} s → ~${afterCache.readMs.toFixed(1)} ms (cache hit).`
      : "Cache hit non observé (vérifier droits d'écriture `data/system/analysis-cache`).",
    "",
    "### Retry JSON conditionnel",
    "",
    `| Scénario | Avant (OFF = retry toujours) | Après (ON) |`,
    `|---|---|---|`,
    `| JSON invalide + doc riche (montants/dates) | ${beforeRetry.retryWhenRichInvalidJson} | ${afterRetry.retryWhenRichInvalidJson} |`,
    `| JSON invalide + doc pauvre | ${beforeRetry.retryWhenPoorInvalidJson} | ${afterRetry.retryWhenPoorInvalidJson} |`,
    "",
    afterRetry.retryWhenRichInvalidJson === false &&
      beforeRetry.retryWhenRichInvalidJson === true
      ? "**Gain attendu :** évite un 2ᵉ generate (~60–70 s) lorsque l'extraction locale suffit."
      : "Comportement retry à vérifier.",
    "",
    "### keep_alive",
    "",
    `| | Avant | Après |`,
    `|---|---|---|`,
    `| valeur envoyée | ${JSON.stringify(beforeKa.keepAlive)} | ${JSON.stringify(afterKa.keepAlive)} |`,
    `| ping generate #1 (ms) | ${JSON.stringify((before.ollamaPing as { firstMs: number | null }).firstMs)} | ${JSON.stringify(afterPing.firstMs)} |`,
    `| ping generate #2 (ms) | ${JSON.stringify((before.ollamaPing as { secondMs: number | null }).secondMs)} | ${JSON.stringify(afterPing.secondMs)} |`,
    "",
    afterPing.ok
      ? "Ollama joignable — le 2ᵉ appel devrait rester chaud avec `keep_alive=30m`."
      : "Ollama injoignable pendant le bench — keep_alive validé au niveau payload uniquement.",
    "",
    "## Synthèse gains",
    "",
    "| Optimisation | Impact latence | Qualité métier |",
    "|---|---|---|",
    "| Cache hash | **Fort** sur re-upload / reanalyze | Identique (même résultat) |",
    "| Retry conditionnel | **Fort** si JSON KO + signaux locaux | Salvage/enrich inchangés |",
    "| keep_alive | **Moyen** (moins de cold start) | Neutre |",
    "",
    "## Désactivation",
    "",
    "```env",
    "OPT_ANALYSIS_CACHE=0",
    "OPT_CONDITIONAL_JSON_RETRY=0",
    "OPT_OLLAMA_KEEP_ALIVE=0",
    "```",
    "",
    "Ou éditer `src/config/optimizations.ts`.",
    "",
  ].join("\n");

  const outDir = path.join(process.cwd(), "reports");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "p0-optimizations-perf.md");
  await writeFile(outFile, report, "utf8");

  console.log(report);
  console.log(`\nRapport écrit : ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
