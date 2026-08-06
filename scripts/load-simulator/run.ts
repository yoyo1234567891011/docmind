/**
 * Test de charge DocMind — ne modifie pas l’application.
 *
 * Usage:
 *   npm run load:test
 *   npm run load:test -- --mode model
 *   npm run load:test -- --mode hybrid --calibrate 5
 *   npm run load:test -- --mode live --users 100 --force-live
 *
 * Niveaux défaut : 100, 500, 1000, 5000, 10000
 * Métriques : P50/P95/P99, CPU, RAM, GPU, Redis, Postgres, S3, Cache, Queue, Timeout
 * Rapport HTML avec graphiques automatiques.
 */

import { access, mkdir, readdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { LoadHttpClient } from "./http-client";
import {
  closeInfraClients,
  probeInfraBurst,
  projectInfraUnderLoad,
  sampleInfraOnce,
  summarizeInfraSamples,
} from "./infra-probes";
import { simulateGpuQueue } from "./queue-model";
import { writeLoadHtmlReport } from "./report-html";
import { aggregateLiveResults, runLiveLevel } from "./scenario";
import {
  startSystemMonitor,
  summarizeSystemSamples,
} from "./system-metrics";
import type {
  LevelMetrics,
  LoadMode,
  LoadSimulationReport,
  SimulatorOptions,
} from "./types";

const ROOT = process.cwd();
const DEFAULT_USERS = [100, 500, 1000, 5000, 10_000];

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
      // optional
    }
  }
}

function parseArgs(argv: string[]): SimulatorOptions {
  const options: SimulatorOptions = {
    baseUrl:
      process.env.EVAL_BASE_URL?.replace(/\/$/, "") || "http://127.0.0.1:3000",
    usersLevels: DEFAULT_USERS,
    mode: "hybrid",
    auth: "eval",
    docsPerUser: 1,
    p2TimeoutMs: 8 * 60 * 1000,
    pollIntervalMs: 4000,
    forceLive: false,
    calibrateUsers: 5,
    evalApiKey: process.env.EVAL_API_KEY,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    outDir: path.join(ROOT, "reports"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url") options.baseUrl = argv[++i]?.replace(/\/$/, "") || options.baseUrl;
    else if (arg === "--users") {
      options.usersLevels = (argv[++i] || "")
        .split(",")
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
    } else if (arg === "--mode") {
      const m = (argv[++i] || "hybrid") as LoadMode;
      if (!["live", "model", "hybrid"].includes(m)) {
        throw new Error("--mode = live | model | hybrid");
      }
      options.mode = m;
    } else if (arg === "--auth") {
      const a = argv[++i] || "eval";
      if (!["eval", "supabase", "none"].includes(a)) {
        throw new Error("--auth = eval | supabase | none");
      }
      options.auth = a as SimulatorOptions["auth"];
    } else if (arg === "--docs-per-user") options.docsPerUser = Number(argv[++i]);
    else if (arg === "--p2-timeout-ms") options.p2TimeoutMs = Number(argv[++i]);
    else if (arg === "--calibrate") options.calibrateUsers = Number(argv[++i]);
    else if (arg === "--force-live") options.forceLive = true;
    else if (arg === "--pdf") options.pdfPath = argv[++i];
    else if (arg === "--out") options.outDir = path.resolve(argv[++i] || options.outDir);
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (options.usersLevels.length === 0) options.usersLevels = DEFAULT_USERS;
  return options;
}

function printHelp() {
  console.log(`Test de charge DocMind

Options:
  --mode hybrid|live|model   Défaut: hybrid
  --users 100,500,1000,5000,10000
  --auth eval|supabase|none  Défaut: eval
  --calibrate 5              Users live pour hybrid
  --docs-per-user 1
  --force-live               Autorise live au-delà de 50 users
  --pdf path/to.pdf
  --base-url http://127.0.0.1:3000
  --out reports

Mesures: P50/P95/P99, CPU, RAM, GPU, Redis, Postgres, S3, Cache, Queue, Timeout
Rapport HTML + graphiques → reports/load-sim-report-latest.html

Exemples:
  npm run load:test
  npm run load:test -- --mode model
  npm run load:test -- --mode hybrid --calibrate 3
  npm run load:test -- --mode live --users 100 --force-live
`);
}

async function findDefaultPdf(explicit?: string): Promise<string> {
  if (explicit) {
    await access(explicit);
    return explicit;
  }
  const root = path.join(ROOT, "test-documents");
  async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const out: string[] = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        out.push(...(await walk(full)));
      } else if (e.name.toLowerCase().endsWith(".pdf")) {
        out.push(full);
      }
    }
    return out;
  }
  try {
    const pdfs = (await walk(root)).sort((a, b) => a.localeCompare(b, "fr"));
    if (pdfs.length === 0) {
      throw new Error("empty");
    }
    return pdfs[0];
  } catch {
    throw new Error(
      "Aucun PDF dans test-documents/. Générez-en avec npm run generate:pdfs",
    );
  }
}

function emptySystem(): LevelMetrics["system"] {
  return {
    avgCpuPercent: null,
    maxCpuPercent: null,
    avgRamPercent: null,
    maxRamPercent: null,
    avgGpuPercent: null,
    maxGpuPercent: null,
  };
}

function modelLevel(
  users: number,
  options: SimulatorOptions,
  calibration: {
    serviceTimeP2Ms: number;
    serviceTimeP1Ms: number;
    uploadMs: number;
    historyMs: number;
    signupMs: number;
  },
  infraBaseline: LevelMetrics["infra"],
  hostSample?: LevelMetrics["system"],
): LevelMetrics {
  const q = simulateGpuQueue({
    concurrentUsers: users,
    docsPerUser: options.docsPerUser,
    serviceTimeP2Ms: calibration.serviceTimeP2Ms,
    serviceTimeP1Ms: calibration.serviceTimeP1Ms,
    uploadMs: calibration.uploadMs,
    historyMs: calibration.historyMs,
    signupMs: calibration.signupMs,
    p2TimeoutMs: options.p2TimeoutMs,
  });
  return {
    concurrentUsers: users,
    mode: "model-projected",
    wallMs: q.wallMs,
    usersCompleted: Math.round(users * (1 - q.failureRate)),
    usersFailed: Math.round(users * q.failureRate),
    failureRate: q.failureRate,
    timeoutCount: q.timeoutCount,
    timeoutRate: q.timeoutRate,
    avgQueueWaitMs: q.avgQueueWaitMs,
    maxQueueWaitMs: q.maxQueueWaitMs,
    p50QueueWaitMs: q.p50QueueWaitMs,
    p95QueueWaitMs: q.p95QueueWaitMs,
    p99QueueWaitMs: q.p99QueueWaitMs,
    avgQueueLength: q.avgQueueLength,
    maxQueueLength: q.maxQueueLength,
    avgP1Ms: q.avgP1Ms,
    p50P1Ms: q.avgP1Ms,
    p95P1Ms: q.avgP1Ms,
    p99P1Ms: q.avgP1Ms,
    avgP2Ms: q.avgP2Ms,
    p50P2Ms: q.p50P2Ms,
    p95P2Ms: q.p95P2Ms,
    p99P2Ms: q.p99P2Ms,
    avgUploadMs: calibration.uploadMs,
    p50UploadMs: calibration.uploadMs,
    p95UploadMs: calibration.uploadMs,
    p99UploadMs: calibration.uploadMs,
    avgHistoryMs: calibration.historyMs,
    avgTotalUserMs: q.avgTotalUserMs,
    p50TotalMs: q.p50TotalMs,
    p95TotalMs: q.p95TotalMs,
    p99TotalMs: q.p99TotalMs,
    saturation: {
      saturated: q.saturated,
      reason: q.reason,
      rho: q.rho,
    },
    system: hostSample ?? emptySystem(),
    infra: projectInfraUnderLoad(infraBaseline, users),
    cache: {
      hits: q.cacheHits,
      total: q.cacheTotal,
      hitRate: q.cacheHitRate,
      note: "Modèle fingerprint (même PDF)",
    },
    notes: q.notes,
  };
}

function buildConclusion(levels: LevelMetrics[]): string {
  const sat = levels.filter((l) => l.saturation.saturated);
  const firstSat = sat[0];
  if (!firstSat) {
    return "Aucun niveau simulé n’atteint la saturation avec les hypothèses actuelles.";
  }
  const at10k = levels.find((l) => l.concurrentUsers >= 10_000);
  const timeoutNote = at10k
    ? ` À 10k users : timeouts ~${((at10k.timeoutRate || 0) * 100).toFixed(0)} %, P99 parcours ${Math.round(at10k.p99TotalMs / 3_600_000)} h.`
    : "";
  return (
    `Saturation à partir de ~${firstSat.concurrentUsers} utilisateurs simultanés ` +
    `(${firstSat.saturation.reason}) ` +
    `Attente file P50 ${Math.round(firstSat.p50QueueWaitMs / 1000)} s, ` +
    `timeouts ${((firstSat.timeoutRate || 0) * 100).toFixed(0)} %.` +
    timeoutNote +
    ` Sur 1 GPU (generate-lock), 1k–10k users exigent file distribuée / workers multiples.`
  );
}

async function captureInfraForLevel(users: number): Promise<LevelMetrics["infra"]> {
  const burst = Math.min(32, Math.max(4, Math.floor(Math.sqrt(users))));
  const samples = await probeInfraBurst(burst);
  return summarizeInfraSamples(samples);
}

async function main() {
  await loadEnv();
  const options = parseArgs(process.argv.slice(2));
  await mkdir(options.outDir, { recursive: true });

  console.log("=== DocMind load test ===");
  console.log(
    `mode=${options.mode} auth=${options.auth} users=${options.usersLevels.join(",")}`,
  );
  console.log(
    "Mesures: P50/P95/P99 · CPU/RAM/GPU · Redis/Postgres/S3 · Cache · Queue · Timeout",
  );

  const pdfPath = await findDefaultPdf(options.pdfPath);
  console.log(`PDF: ${pdfPath}`);

  const calibration = {
    serviceTimeP2Ms: 175_000,
    serviceTimeP1Ms: 150,
    uploadMs: 200,
    historyMs: 50,
    signupMs: 100,
    throughputPerHour: 3600_000 / 175_000,
  };

  console.log("Probe infra baseline (Redis / Postgres / S3)...");
  const baselineSamples = [
    await sampleInfraOnce(),
    await sampleInfraOnce(),
    await sampleInfraOnce(),
  ];
  const infraBaseline = summarizeInfraSamples(baselineSamples);
  console.log(
    `  Redis: ${infraBaseline.redis.configured ? `${infraBaseline.redis.avgMs} ms` : "N/C"}` +
      ` · PG: ${infraBaseline.postgres.configured ? `${infraBaseline.postgres.avgMs} ms` : "N/C"}` +
      ` · S3: ${infraBaseline.s3.configured ? `${infraBaseline.s3.avgMs} ms` : "N/C"}`,
  );

  const levels: LevelMetrics[] = [];
  const client = new LoadHttpClient(
    options.baseUrl,
    options.auth === "supabase" ? "eval" : options.auth,
    options.evalApiKey,
  );

  if (options.auth === "supabase") {
    console.warn(
      "[warn] --auth supabase : signup mesurable ; parcours API live via EVAL_API_KEY/none.",
    );
  }

  const needsLive = options.mode === "live" || options.mode === "hybrid";

  if (needsLive) {
    if (options.auth === "eval" && !options.evalApiKey) {
      throw new Error(
        "EVAL_API_KEY requis pour --auth eval (live/hybrid). Ou --mode model.",
      );
    }
    const health = await client.health();
    if (!health.ok && health.status === "maintenance") {
      throw new Error("Serveur en maintenance");
    }
    console.log(`Health: ${health.status}`);
  }

  if (options.mode === "live") {
    for (const users of options.usersLevels) {
      if (users > 50 && !options.forceLive) {
        console.warn(
          `[skip] ${users} users live refusé sans --force-live → projection modèle.`,
        );
        levels.push(modelLevel(users, options, calibration, infraBaseline));
        continue;
      }
      console.log(`\n--- LIVE ${users} users ---`);
      const monitor = startSystemMonitor(2000);
      const infraPromise = captureInfraForLevel(users);
      const live = await runLiveLevel({
        users,
        options,
        pdfPath,
        baseClient: client,
      });
      const samples = monitor.stop();
      const system = summarizeSystemSamples(samples);
      const infra = await infraPromise;
      const agg = aggregateLiveResults({
        users,
        results: live.results,
        queue: live.queue,
        wallMs: live.wallMs,
        system,
        infra,
        modeLabel: "live",
      });
      levels.push(agg);
      if (agg.avgP2Ms > 0) {
        calibration.serviceTimeP2Ms = agg.avgP2Ms;
        calibration.throughputPerHour = 3600_000 / Math.max(agg.avgP2Ms, 1);
      }
      if (agg.avgP1Ms > 0) calibration.serviceTimeP1Ms = agg.avgP1Ms;
      if (agg.avgUploadMs > 0) calibration.uploadMs = agg.avgUploadMs;
      if (agg.avgHistoryMs > 0) calibration.historyMs = agg.avgHistoryMs;
    }
  } else if (options.mode === "hybrid") {
    const calN = Math.min(
      options.calibrateUsers,
      Math.min(...options.usersLevels.filter((n) => n <= 50), 5) || 5,
    );
    console.log(`\n--- HYBRID calibrate LIVE n=${calN} ---`);
    const monitor = startSystemMonitor(2000);
    const infraPromise = captureInfraForLevel(calN);
    const live = await runLiveLevel({
      users: calN,
      options: { ...options, docsPerUser: 1 },
      pdfPath,
      baseClient: client,
    });
    const samples = monitor.stop();
    const system = summarizeSystemSamples(samples);
    const infra = await infraPromise;
    const agg = aggregateLiveResults({
      users: calN,
      results: live.results,
      queue: live.queue,
      wallMs: live.wallMs,
      system,
      infra,
      modeLabel: "live-calibrate",
    });
    levels.push(agg);
    if (agg.avgP2Ms > 1000) {
      const serviceGuess = Math.max(
        agg.avgP1Ms * 10,
        Math.min(agg.avgP2Ms, agg.p95P2Ms),
      );
      calibration.serviceTimeP2Ms =
        calN <= 2 ? Math.max(agg.avgP2Ms, 30_000) : Math.max(serviceGuess / calN, 30_000);
      const p2Steps = live.results
        .flatMap((r) => r.steps)
        .filter((s) => s.step === "analyze_p2" && s.ok);
      if (p2Steps.length === 1) {
        calibration.serviceTimeP2Ms = p2Steps[0].durationMs;
      } else if (calN === 1 && p2Steps[0]) {
        calibration.serviceTimeP2Ms = p2Steps[0].durationMs;
      } else if (p2Steps.length > 0) {
        calibration.serviceTimeP2Ms = Math.min(
          ...p2Steps.map((s) => s.durationMs),
        );
      }
      calibration.throughputPerHour =
        3600_000 / calibration.serviceTimeP2Ms;
    }
    if (agg.avgP1Ms > 0) calibration.serviceTimeP1Ms = agg.avgP1Ms;
    if (agg.avgUploadMs > 0) calibration.uploadMs = agg.avgUploadMs;
    if (agg.avgHistoryMs > 0) calibration.historyMs = agg.avgHistoryMs;
    console.log(
      `Calibration P2 service ≈ ${(calibration.serviceTimeP2Ms / 1000).toFixed(1)} s`,
    );

    for (const users of options.usersLevels) {
      if (users === calN) continue;
      console.log(`--- MODEL project ${users} users ---`);
      levels.push(modelLevel(users, options, calibration, infraBaseline, system));
    }
  } else {
    // pure model — short host sample + infra burst per level
    const monitor = startSystemMonitor(1500);
    await new Promise((r) => setTimeout(r, 3200));
    const host = summarizeSystemSamples(monitor.stop());

    for (const users of options.usersLevels) {
      console.log(`--- MODEL ${users} users ---`);
      const infra = await captureInfraForLevel(Math.min(users, 64));
      const projected = projectInfraUnderLoad(
        infra.redis.samples > 0 ? infra : infraBaseline,
        users,
      );
      const level = modelLevel(users, options, calibration, infraBaseline, host);
      level.infra = projected;
      levels.push(level);
    }
  }

  levels.sort((a, b) => a.concurrentUsers - b.concurrentUsers);

  const report: LoadSimulationReport = {
    generatedAt: new Date().toISOString(),
    options,
    calibration: {
      serviceTimeP2Ms: calibration.serviceTimeP2Ms,
      serviceTimeP1Ms: calibration.serviceTimeP1Ms,
      throughputPerHour: calibration.throughputPerHour,
    },
    levels,
    conclusion: buildConclusion(levels),
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(options.outDir, `load-sim-report-${stamp}.html`);
  await writeLoadHtmlReport(report, outPath);
  const jsonPath = path.join(options.outDir, `load-sim-report-${stamp}.json`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(options.outDir, "load-sim-report-latest.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  await closeInfraClients();

  console.log(`\nRapport HTML : ${outPath}`);
  console.log(
    `Rapport latest : ${path.join(options.outDir, "load-sim-report-latest.html")}`,
  );
  console.log(`JSON : ${jsonPath}`);
  console.log(`\nConclusion: ${report.conclusion}`);

  // Console summary table
  console.log("\nUsers | P50 | P95 | P99 | Timeout | QueueP50 | Redis | PG | S3");
  for (const l of levels) {
    console.log(
      `${String(l.concurrentUsers).padStart(5)} | ` +
        `${fmtShort(l.p50TotalMs)} | ${fmtShort(l.p95TotalMs)} | ${fmtShort(l.p99TotalMs)} | ` +
        `${(l.timeoutRate * 100).toFixed(0).padStart(3)}% | ${fmtShort(l.p50QueueWaitMs)} | ` +
        `${fmtInfra(l.infra.redis)} | ${fmtInfra(l.infra.postgres)} | ${fmtInfra(l.infra.s3)}`,
    );
  }
}

function fmtShort(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(0)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function fmtInfra(s: { configured: boolean; p50Ms: number | null }): string {
  if (!s.configured || s.p50Ms == null) return "N/C";
  return `${s.p50Ms}ms`;
}

main().catch(async (error) => {
  console.error(error);
  await closeInfraClients().catch(() => undefined);
  process.exit(1);
});
