/**
 * Mesure P2 (fast orchestrator) sur un extrait texte — sans UI.
 * Usage: npx tsx --tsconfig tsconfig.json scripts/measure-p2-latency.ts [fichier.md|pdf-texte]
 */
import { readFileSync, existsSync } from "fs";
import path from "path";

import { runFastMultiAgentAnalysis } from "../src/ai/agents/fast-orchestrator";
import { getLlmProviderConfig } from "../src/ai/models/llm-provider";
import { ensureAdminRuntimeLoaded } from "../src/services/admin/runtime";

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

async function main() {
  loadEnv();
  await ensureAdminRuntimeLoaded();

  const sample =
    process.argv[2] ||
    "test-documents/factures-edf/02-facture-electricite-edf-465605.md";
  const abs = path.isAbsolute(sample) ? sample : path.join(process.cwd(), sample);
  if (!existsSync(abs)) {
    throw new Error(`Fichier introuvable: ${abs}`);
  }
  const text = readFileSync(abs, "utf8").trim();
  const provider = getLlmProviderConfig();
  const model =
    provider.kind === "openai_compatible" ? provider.model : "(ollama)";

  console.log(`[p2-bench] model=${model} chars=${text.length} file=${path.basename(abs)}`);

  const started = Date.now();
  const result = await runFastMultiAgentAnalysis({
    documentText: text,
    fileName: path.basename(abs),
  });
  const wallMs = Date.now() - started;

  console.log(
    JSON.stringify(
      {
        wallSec: +(wallMs / 1000).toFixed(2),
        tokens: result.state.tokens,
        steps: result.state.steps.map((s) => ({
          task: s.task,
          durationMs: s.durationMs,
          tokens: s.tokens?.total ?? 0,
          ok: s.ok,
        })),
        summaryPreview: result.analysis.summary.slice(0, 120),
        riskScore: result.analysis.risk_score,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
