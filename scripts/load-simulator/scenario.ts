import { randomUUID } from "crypto";

import { LoadHttpClient, signupSupabaseUser } from "./http-client";
import { emptyInfraSummary, latencyOf, percentile } from "./stats";
import type {
  InfraProbeSummary,
  LevelMetrics,
  SimulatorOptions,
  UserStepResult,
  VirtualUserResult,
} from "./types";

/** Compteur global de file P2 (client-side) pour mesurer la longueur de file live. */
export class LiveQueueTracker {
  private waiting = 0;
  private samples: number[] = [];

  enter() {
    this.waiting += 1;
    this.samples.push(this.waiting);
  }

  leave() {
    this.waiting = Math.max(0, this.waiting - 1);
    this.samples.push(this.waiting);
  }

  snapshot() {
    if (this.samples.length === 0) {
      return { avg: 0, max: 0 };
    }
    const avg =
      this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    return { avg, max: Math.max(...this.samples) };
  }
}

export async function runVirtualUser(input: {
  index: number;
  options: SimulatorOptions;
  pdfPath: string;
  queue: LiveQueueTracker;
  baseClient: LoadHttpClient;
}): Promise<VirtualUserResult> {
  const steps: UserStepResult[] = [];
  const t0 = Date.now();
  let client = input.baseClient;
  let userId = `vu-${input.index}`;
  let ok = true;

  // 1. Compte
  const signupStarted = Date.now();
  try {
    if (input.options.auth === "supabase") {
      if (!input.options.supabaseUrl || !input.options.supabaseAnonKey) {
        throw new Error("Supabase URL/anon key manquants");
      }
      const email = `loadtest+${Date.now()}-${input.index}@gmail.com`;
      const password = `LoadTest!${randomUUID().slice(0, 8)}aA1`;
      const session = await signupSupabaseUser({
        supabaseUrl: input.options.supabaseUrl,
        anonKey: input.options.supabaseAnonKey,
        email,
        password,
      });
      userId = session.userId;
      client = client.withToken(session.accessToken);
    } else if (input.options.auth === "eval") {
      userId = `eval-runner#${input.index}`;
    } else {
      userId = `local-dev#${input.index}`;
    }
    steps.push({
      step: "signup",
      ok: true,
      durationMs: Date.now() - signupStarted,
      meta: { auth: input.options.auth, userId },
    });
  } catch (error) {
    ok = false;
    steps.push({
      step: "signup",
      ok: false,
      durationMs: Date.now() - signupStarted,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      userIndex: input.index,
      userId,
      steps,
      ok,
      totalMs: Date.now() - t0,
    };
  }

  for (let d = 0; d < input.options.docsPerUser; d += 1) {
    // 2. Upload
    const upStarted = Date.now();
    let upload: Awaited<ReturnType<LoadHttpClient["uploadPdf"]>>;
    try {
      upload = await client.uploadPdf(input.pdfPath);
      steps.push({
        step: "upload",
        ok: true,
        durationMs: upload.durationMs || Date.now() - upStarted,
        meta: { documentId: upload.documentId, textChars: upload.text.length },
      });
    } catch (error) {
      ok = false;
      steps.push({
        step: "upload",
        ok: false,
        durationMs: Date.now() - upStarted,
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }

    if (!upload.text.trim()) {
      ok = false;
      steps.push({
        step: "analyze_p1",
        ok: false,
        durationMs: 0,
        error: "PDF sans texte extractible",
      });
      break;
    }

    // 3. Analyze P1 — nonce unique pour éviter le cache analyse (mesure generate réelle)
    const loadNonce = `load-${input.index}-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const textForAnalyze = `${upload.text}\n\n[docmind-load-nonce:${loadNonce}]`;
    const pagesForAnalyze = upload.pages?.length
      ? [...upload.pages.slice(0, -1), `${upload.pages.at(-1) ?? ""}\n[docmind-load-nonce:${loadNonce}]`]
      : undefined;
    input.queue.enter();
    const queueEnterAt = Date.now();
    try {
      const p1 = await client.analyzeProgressive({
        documentId: upload.documentId,
        text: textForAnalyze,
        fileName: upload.fileName,
        pages: pagesForAnalyze,
      });
      steps.push({
        step: "analyze_p1",
        ok: true,
        durationMs: p1.durationMs,
        meta: {
          historyId: p1.historyId ?? null,
          jobId: p1.jobId ?? null,
          jobStatus: p1.jobStatus ?? null,
          documentType: p1.documentType ?? null,
          resultSource: p1.resultSource ?? null,
        },
      });

      // 4. Wait P2 via job durable (metrics réelles) — fallback history
      if (p1.jobId) {
        const p2 = await client.waitAnalysisJobComplete({
          jobId: p1.jobId,
          timeoutMs: input.options.p2TimeoutMs,
          pollIntervalMs: input.options.pollIntervalMs,
        });
        const m = p2.metrics;
        steps.push({
          step: "analyze_p2",
          ok: !p2.timeout && p2.status === "completed",
          durationMs: p2.durationMs,
          timeout: p2.timeout,
          queueWaitMs: m?.queueWaitMs,
          error: p2.timeout
            ? "Timeout attente job (poll)"
            : p2.status === "failed"
              ? "Job failed"
              : undefined,
          meta: {
            historyId: p1.historyId ?? null,
            jobId: p1.jobId ?? null,
            status: p2.status ?? null,
            queuePosition: p2.queuePosition ?? null,
            queueWaitMs: m?.queueWaitMs ?? null,
            lockWaitMs: m?.lockWaitMs ?? null,
            generateMs: m?.generateMs ?? null,
            historyMs: m?.historyMs ?? null,
            memoryMs: m?.memoryMs ?? null,
            totalMs: m?.totalMs ?? null,
            queueEnterLagMs: Date.now() - queueEnterAt,
            pollTimeout: p2.timeout,
          },
        });
        // Timeout de polling client ≠ échec serveur si le job est encore actif
        if (p2.status === "failed") ok = false;
        else if (p2.timeout && p2.status !== "completed") {
          // Job encore pending/processing : marqué timeout client, pas forcément FAIL produit
          ok = false;
        } else if (!p2.timeout && p2.status !== "completed") ok = false;
      } else if (p1.historyId) {
        const p2 = await client.waitHistoryComplete({
          historyId: p1.historyId,
          timeoutMs: input.options.p2TimeoutMs,
          pollIntervalMs: input.options.pollIntervalMs,
        });
        steps.push({
          step: "analyze_p2",
          ok: !p2.timeout,
          durationMs: p2.durationMs,
          timeout: p2.timeout,
          error: p2.timeout
            ? "Timeout attente P2 (poll history — pas de jobId)"
            : undefined,
          meta: {
            historyId: p1.historyId,
            legacyHistoryPoll: true,
          },
        });
        if (p2.timeout) ok = false;
      } else {
        steps.push({
          step: "analyze_p2",
          ok: false,
          durationMs: 0,
          error: "Pas de jobId/historyId — P2 non planifiée",
        });
        ok = false;
      }
    } catch (error) {
      ok = false;
      steps.push({
        step: "analyze_p1",
        ok: false,
        durationMs: Date.now() - queueEnterAt,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      input.queue.leave();
    }
  }

  // 5. Historique
  const histStarted = Date.now();
  try {
    const hist = await client.listHistory();
    steps.push({
      step: "history",
      ok: true,
      durationMs: hist.durationMs || Date.now() - histStarted,
      meta: { count: hist.count },
    });
  } catch (error) {
    ok = false;
    steps.push({
      step: "history",
      ok: false,
      durationMs: Date.now() - histStarted,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    userIndex: input.index,
    userId,
    steps,
    ok,
    totalMs: Date.now() - t0,
  };
}

export async function runLiveLevel(input: {
  users: number;
  options: SimulatorOptions;
  pdfPath: string;
  baseClient: LoadHttpClient;
}): Promise<{
  results: VirtualUserResult[];
  queue: ReturnType<LiveQueueTracker["snapshot"]>;
  wallMs: number;
}> {
  const queue = new LiveQueueTracker();
  const started = Date.now();
  const tasks = Array.from({ length: input.users }, (_, index) =>
    runVirtualUser({
      index,
      options: input.options,
      pdfPath: input.pdfPath,
      queue,
      baseClient: input.baseClient,
    }),
  );
  const results = await Promise.all(tasks);
  return {
    results,
    queue: queue.snapshot(),
    wallMs: Date.now() - started,
  };
}

export function aggregateLiveResults(input: {
  users: number;
  results: VirtualUserResult[];
  queue: { avg: number; max: number };
  wallMs: number;
  system: LevelMetrics["system"];
  infra: {
    redis: InfraProbeSummary;
    postgres: InfraProbeSummary;
    s3: InfraProbeSummary;
  };
  modeLabel: "live" | "live-calibrate";
}): LevelMetrics {
  const stepMs = (name: UserStepResult["step"], onlyOk = true) =>
    input.results
      .flatMap((r) => r.steps)
      .filter((s) => s.step === name && (onlyOk ? s.ok : true))
      .map((s) => s.durationMs);

  const p1 = stepMs("analyze_p1");
  const p2 = stepMs("analyze_p2", false);
  const p2Ok = stepMs("analyze_p2", true);
  const p2Vals = p2.length ? p2 : p2Ok;
  const uploads = stepMs("upload");
  const history = stepMs("history");
  const queueWaits = input.results
    .flatMap((r) => r.steps)
    .filter((s) => s.step === "analyze_p2" && s.queueWaitMs != null)
    .map((s) => s.queueWaitMs as number);
  const metaNum = (key: string) =>
    input.results
      .flatMap((r) => r.steps)
      .filter((s) => s.step === "analyze_p2" && typeof s.meta?.[key] === "number")
      .map((s) => s.meta![key] as number);
  const lockWaits = metaNum("lockWaitMs");
  const generates = metaNum("generateMs");
  const jobHistories = metaNum("historyMs");
  const memories = metaNum("memoryMs");
  const jobTotals = metaNum("totalMs");
  const timeouts = input.results
    .flatMap((r) => r.steps)
    .filter((s) => s.timeout).length;
  const failedUsers = input.results.filter((r) => !r.ok).length;
  const totals = input.results.map((r) => r.totalMs);

  const p1L = latencyOf(p1);
  const p2L = latencyOf(p2Vals);
  const upL = latencyOf(uploads);
  const totL = latencyOf(totals);
  const histL = latencyOf(history);

  let cacheHits = 0;
  let cacheTotal = 0;
  for (const s of input.results.flatMap((r) => r.steps)) {
    if (s.step !== "analyze_p1") continue;
    const src = s.meta?.resultSource;
    if (typeof src !== "string" || !src) continue;
    cacheTotal += 1;
    if (src === "cache") cacheHits += 1;
  }

  const p2Steps = input.results.flatMap((r) =>
    r.steps.filter((s) => s.step === "analyze_p2"),
  );
  const jobsSuccess = p2Steps.filter(
    (s) => s.ok && s.meta?.status === "completed",
  ).length;
  const jobsFailed = p2Steps.filter((s) => s.meta?.status === "failed").length;
  const jobsTimeout = p2Steps.filter((s) => s.timeout).length;
  const metricsMeasured =
    queueWaits.length > 0 &&
    generates.length > 0 &&
    generates.every((g) => Number.isFinite(g) && g >= 0) &&
    // generateMs=0 sur completed est suspect (sauf cache) — exiger >0 si completed
    (jobsSuccess === 0 || generates.some((g) => g > 0));

  const avgQueue =
    queueWaits.length === 0
      ? 0
      : Math.round(
          queueWaits.reduce((a, b) => a + b, 0) / queueWaits.length,
        );
  const saturated =
    input.queue.max >= Math.max(2, Math.floor(input.users * 0.5)) ||
    avgQueue > 60_000;

  return {
    concurrentUsers: input.users,
    mode: input.modeLabel,
    wallMs: input.wallMs,
    usersCompleted: input.users - failedUsers,
    usersFailed: failedUsers,
    jobsSuccess,
    jobsFailed,
    jobsTimeout,
    metricsMeasured,
    failureRate: input.users === 0 ? 0 : failedUsers / input.users,
    timeoutCount: timeouts,
    timeoutRate:
      input.users === 0 ? 0 : timeouts / Math.max(input.users, 1),
    avgQueueWaitMs: avgQueue,
    maxQueueWaitMs: queueWaits.length ? Math.max(...queueWaits) : 0,
    p50QueueWaitMs: percentile(queueWaits, 50),
    p95QueueWaitMs: percentile(queueWaits, 95),
    p99QueueWaitMs: percentile(queueWaits, 99),
    p50LockWaitMs: percentile(lockWaits, 50),
    p95LockWaitMs: percentile(lockWaits, 95),
    p99LockWaitMs: percentile(lockWaits, 99),
    p50GenerateMs: percentile(generates, 50),
    p95GenerateMs: percentile(generates, 95),
    p99GenerateMs: percentile(generates, 99),
    p50JobHistoryMs: percentile(jobHistories, 50),
    p95JobHistoryMs: percentile(jobHistories, 95),
    p99JobHistoryMs: percentile(jobHistories, 99),
    p50MemoryMs: percentile(memories, 50),
    p95MemoryMs: percentile(memories, 95),
    p99MemoryMs: percentile(memories, 99),
    p50JobTotalMs: percentile(jobTotals, 50),
    p95JobTotalMs: percentile(jobTotals, 95),
    p99JobTotalMs: percentile(jobTotals, 99),
    avgQueueLength: Math.round(input.queue.avg * 10) / 10,
    maxQueueLength: input.queue.max,
    avgP1Ms: p1L.avgMs,
    p50P1Ms: p1L.p50Ms,
    p95P1Ms: p1L.p95Ms,
    p99P1Ms: p1L.p99Ms,
    avgP2Ms: p2L.avgMs,
    p50P2Ms: p2L.p50Ms,
    p95P2Ms: p2L.p95Ms,
    p99P2Ms: p2L.p99Ms,
    avgUploadMs: upL.avgMs,
    p50UploadMs: upL.p50Ms,
    p95UploadMs: upL.p95Ms,
    p99UploadMs: upL.p99Ms,
    avgHistoryMs: histL.avgMs,
    avgTotalUserMs: totL.avgMs,
    p50TotalMs: totL.p50Ms,
    p95TotalMs: totL.p95Ms,
    p99TotalMs: totL.p99Ms,
    saturation: {
      saturated,
      reason: saturated
        ? "File P2 / attentes élevées observées en live."
        : "Charge live absorbée sans saturation marquée.",
      rho: Math.min(1, input.queue.max / Math.max(input.users, 1)),
    },
    system: input.system,
    infra: input.infra,
    cache: {
      hits: cacheHits,
      total: cacheTotal,
      hitRate: cacheTotal === 0 ? 0 : cacheHits / cacheTotal,
      note:
        cacheTotal === 0
          ? "resultSource absent des réponses P1"
          : undefined,
    },
    notes: [
      `Live ${input.users} users — wall ${(input.wallMs / 1000).toFixed(1)} s`,
      `Timeouts P2: ${timeouts}`,
      `P50/P95/P99 parcours: ${totL.p50Ms}/${totL.p95Ms}/${totL.p99Ms} ms`,
    ],
  };
}

export function emptyInfraBundle(): LevelMetrics["infra"] {
  return {
    redis: emptyInfraSummary(),
    postgres: emptyInfraSummary(),
    s3: emptyInfraSummary(),
  };
}
