/**
 * Benchmark DocMind vs ChatGPT / Claude / Gemini / Mistral Le Chat.
 *
 * Usage:
 *   npm run benchmark
 *   npm run benchmark:quick
 *   npm run benchmark -- --limit 1 --providers docmind,claude
 *
 * DocMind toujours exécuté (serveur requis). Cloud optionnels via clés API.
 */
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { ensureEmbeddingModel } from "../../src/ai/evaluator";

import { loadBenchmarkCorpus } from "./corpus";
import {
  CLOUD_PROVIDERS,
  cloudSkipReason,
  isCloudEnabled,
  runCloudProvider,
} from "./providers/cloud";
import {
  ensureDocmindUp,
  providerCachePath,
  resolveDocmindBaseUrl,
  runDocmind,
} from "./providers/docmind";
import {
  aggregateScores,
  buildDifferencesSummary,
  writeBenchmarkHtmlReport,
} from "./report";
import { scoreProviderDoc } from "./score";
import type {
  BenchmarkProviderId,
  BenchmarkRunResult,
  DocProviderScore,
  ProviderPrediction,
} from "./types";

const ROOT = process.cwd();
const REPORT_DIR = path.join(ROOT, "reports");

function loadEnvFile(content: string) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
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

interface Cli {
  limitPerSuite: number;
  providers?: Set<BenchmarkProviderId>;
  baseUrl: string;
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    limitPerSuite: Number(process.env.BENCHMARK_LIMIT || 2),
    baseUrl: resolveDocmindBaseUrl(),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--limit") {
      cli.limitPerSuite = Number(argv[++i] || 2);
    } else if (arg === "--providers") {
      const raw = (argv[++i] || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean) as BenchmarkProviderId[];
      cli.providers = new Set(raw);
    } else if (arg === "--base-url") {
      cli.baseUrl = (argv[++i] || cli.baseUrl).replace(/\/$/, "");
    }
  }
  return cli;
}

function wantProvider(
  id: BenchmarkProviderId,
  filter?: Set<BenchmarkProviderId>,
): boolean {
  if (!filter || filter.size === 0) return true;
  return filter.has(id);
}

async function main() {
  await loadEnv();
  const cli = parseArgs(process.argv.slice(2));
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(REPORT_DIR, "benchmark", runId);
  await mkdir(runDir, { recursive: true });

  console.log("\n══ Benchmark DocMind ══\n");
  console.log(`Base URL : ${cli.baseUrl}`);
  console.log(`Limit / suite : ${cli.limitPerSuite}`);

  await ensureDocmindUp(cli.baseUrl);
  process.stdout.write("Embeddings (scoring sémantique)… ");
  await ensureEmbeddingModel().catch(() => undefined);
  console.log("ok");

  const docs = await loadBenchmarkCorpus({
    limitPerSuite: cli.limitPerSuite,
  });
  if (docs.length === 0) {
    throw new Error("Aucun document de benchmark trouvé dans test-documents/");
  }
  console.log(`Documents : ${docs.length}`);

  const enabledMeta: Array<{
    id: BenchmarkProviderId;
    enabled: boolean;
    skipReason?: string;
    model: string;
  }> = [];

  const runDocmindFlag = wantProvider("docmind", cli.providers);
  enabledMeta.push({
    id: "docmind",
    enabled: runDocmindFlag,
    skipReason: runDocmindFlag ? undefined : "Exclu par --providers",
    model: "ollama-local",
  });

  for (const cfg of CLOUD_PROVIDERS) {
    const wanted = wantProvider(cfg.id, cli.providers);
    const hasKey = isCloudEnabled(cfg);
    enabledMeta.push({
      id: cfg.id,
      enabled: wanted && hasKey,
      skipReason: !wanted
        ? "Exclu par --providers"
        : hasKey
          ? undefined
          : cloudSkipReason(cfg),
      model:
        (cfg.modelEnv && process.env[cfg.modelEnv]?.trim()) || cfg.defaultModel,
    });
  }

  for (const m of enabledMeta) {
    console.log(
      `· ${m.id.padEnd(10)} ${m.enabled ? "ON " : "OFF"} ${m.skipReason || m.model}`,
    );
  }

  const scores: DocProviderScore[] = [];

  for (const doc of docs) {
    console.log(`\n→ ${doc.relativePath} [${doc.suites.join(", ")}]`);
    try {
      // DocMind first — fournit aussi le texte source pour les providers texte.
      let sourceText = "";
      if (runDocmindFlag) {
        process.stdout.write("  docmind… ");
        const dm = await runDocmind(doc, cli.baseUrl);
        sourceText = dm.sourceText;
        const rawPath = providerCachePath(runDir, "docmind", doc);
        await mkdir(path.dirname(rawPath), { recursive: true });
        await writeFile(
          rawPath,
          JSON.stringify(dm.prediction, null, 2),
          "utf8",
        );
        const scored = await scoreProviderDoc({
          doc,
          prediction: dm.prediction,
          sourceText,
        });
        scores.push(scored);
        console.log(
          scored.error
            ? `ERR ${scored.error}`
            : `q=${(scored.quality * 100).toFixed(0)}% hallu=${(scored.hallucinationRate * 100).toFixed(0)}% cite=${(scored.citationRate * 100).toFixed(0)}% ${scored.durationMs}ms`,
        );
      } else if (doc.markdownPath) {
        sourceText = await readFile(doc.markdownPath, "utf8");
      }

      if (!sourceText) {
        console.log("  skip cloud — pas de texte source");
        continue;
      }

      for (const cfg of CLOUD_PROVIDERS) {
        const meta = enabledMeta.find((m) => m.id === cfg.id);
        if (!meta?.enabled) continue;

        process.stdout.write(`  ${cfg.id}… `);
        const prediction: ProviderPrediction = await runCloudProvider({
          cfg,
          doc,
          sourceText,
        });
        const rawPath = providerCachePath(runDir, cfg.id, doc);
        await mkdir(path.dirname(rawPath), { recursive: true });
        await writeFile(rawPath, JSON.stringify(prediction, null, 2), "utf8");

        const scored = await scoreProviderDoc({
          doc,
          prediction,
          sourceText,
        });
        scores.push(scored);
        console.log(
          prediction.error
            ? `ERR ${prediction.error.slice(0, 80)}`
            : `q=${(scored.quality * 100).toFixed(0)}% hallu=${(scored.hallucinationRate * 100).toFixed(0)}% cite=${(scored.citationRate * 100).toFixed(0)}% ${scored.durationMs}ms (${prediction.inputMode})`,
        );
      }
    } catch (error) {
      console.log(
        `  FAIL ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const aggregates = aggregateScores(scores, enabledMeta);
  const differencesSummary = buildDifferencesSummary(aggregates);

  const result: BenchmarkRunResult = {
    at: new Date().toISOString(),
    runId,
    docs,
    scores,
    aggregates,
    differencesSummary,
  };

  const { htmlPath } = await writeBenchmarkHtmlReport(result, REPORT_DIR);

  console.log("\n── Résumé des différences ──");
  for (const line of differencesSummary) {
    console.log(`• ${line}`);
  }
  console.log(`\nRapport : ${htmlPath}`);
  console.log(`Latest  : ${path.join(REPORT_DIR, "benchmark-latest.html")}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
