/**
 * Mesure RÉELLE de latence Ollama (pas load-sim model).
 *
 * Usage: npm run measure:ollama
 * Prérequis: Ollama UP + éventuellement serveur Next (sinon mesure generate directe).
 *
 * Exit 0 + rapport JSON ; exit 2 si Ollama absent (BLOCKED, pas FAIL).
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { computePerfStats, percentile } from "./lib/perf-stats";
import { loadEnvFiles } from "./lib/load-env-files";

loadEnvFiles(process.cwd(), { override: false });

const OLLAMA = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(
  /\/$/,
  "",
);
const RUNS = Math.max(3, Number(process.env.OLLAMA_MEASURE_RUNS || 5));
const PROMPT =
  process.env.OLLAMA_MEASURE_PROMPT ||
  "Résume en une phrase: contrat d'assurance habitation AXA, échéance 2026-12-01.";

async function ollamaUp(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function pickModel(): Promise<string> {
  const forced = process.env.OLLAMA_MODEL?.trim();
  if (forced) return forced;
  const res = await fetch(`${OLLAMA}/api/tags`);
  const json = (await res.json()) as {
    models?: Array<{ name?: string }>;
  };
  const name = json.models?.[0]?.name;
  if (!name) throw new Error("Aucun modèle Ollama");
  return name;
}

async function generateOnce(model: string): Promise<{
  ms: number;
  ok: boolean;
  timedOut: boolean;
}> {
  const t0 = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const res = await fetch(`${OLLAMA}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: PROMPT,
        stream: false,
        options: { num_predict: 64 },
      }),
      signal: controller.signal,
    });
    const ms = performance.now() - t0;
    if (!res.ok) return { ms, ok: false, timedOut: false };
    await res.json();
    return { ms, ok: true, timedOut: false };
  } catch (error) {
    const ms = performance.now() - t0;
    const timedOut =
      error instanceof Error &&
      (error.name === "AbortError" || /abort/i.test(error.message));
    return { ms, ok: false, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (!(await ollamaUp())) {
    console.error("BLOCKED: Ollama injoignable — pas de mesure live.");
    process.exit(2);
  }

  const model = await pickModel();
  console.log(`Ollama OK — model=${model} runs=${RUNS}`);

  // warm-up
  await generateOnce(model);

  const samples: number[] = [];
  let success = 0;
  let timeouts = 0;
  for (let i = 0; i < RUNS; i += 1) {
    const r = await generateOnce(model);
    samples.push(r.ms);
    if (r.ok) success += 1;
    if (r.timedOut) timeouts += 1;
    console.log(
      `  run ${i + 1}/${RUNS}: ${r.ok ? "OK" : "FAIL"} ${Math.round(r.ms)}ms`,
    );
  }

  const stats = computePerfStats(samples);
  const successRate = success / RUNS;
  const timeoutRate = timeouts / RUNS;
  const throughputPerHour =
    stats.mean > 0 ? (3600_000 / stats.mean) * successRate : 0;

  const report = {
    kind: "ollama-live",
    generatedAt: new Date().toISOString(),
    model,
    promptHash: createHash("sha256").update(PROMPT).digest("hex").slice(0, 12),
    runs: RUNS,
    success,
    successRate,
    timeoutRate,
    latencyMs: stats,
    p50: stats.median,
    p95: stats.p95,
    p99: percentile([...samples].sort((a, b) => a - b), 99),
    throughputPerHourGpu: throughputPerHour,
    cacheHitRate: null,
    note: "Mesure generate Ollama directe — pas load-sim. Cache applicatif non mesuré ici.",
    objectives: {
      avgLt120s: stats.mean < 120_000,
      p95Lt180s: stats.p95 < 180_000,
      timeoutLt5pct: timeoutRate < 0.05,
      successGte95pct: successRate >= 0.95,
      throughputGte15: throughputPerHour >= 15,
    },
  };

  const dir = path.join(process.cwd(), "reports");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `ollama-live-${stamp}.json`);
  await writeFile(file, JSON.stringify(report, null, 2), "utf8");
  await writeFile(
    path.join(dir, "ollama-live-latest.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );

  console.log("\n=== OLLAMA LIVE ===");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Report: ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
