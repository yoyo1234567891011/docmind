/**
 * Worker d'analyse — claim PG/FS puis P2 sous withOllamaGenerateLock
 * (via analyzeDocumentText → generate).
 */
import { randomUUID } from "crypto";

import { analyzeDocumentText } from "@/ai/pipelines";
import { estimateAnalysisCostEur } from "@/config/analytics";
import { AppError } from "@/lib/errors";
import { trackAnalyticsEvent } from "@/services/analytics";
import {
  getHistoryRecord,
  updateHistoryRecord,
} from "@/services/history";
import { attachHistoryIdToLatestLog } from "@/services/logs";
import { appendMonitoringEvent } from "@/services/monitoring/store";
import {
  notifyAnalysisReady,
  notifyForHistoryRecord,
} from "@/services/notifications";
import { isLlmAnalysisSuccess } from "@/ai/agents/core-bundle-outcome";
import { EMPTY_READY_REPLY } from "@/types";

import {
  claimNextAnalysisJob,
  completeAnalysisJob,
  failAnalysisJob,
  heartbeatAnalysisJob,
  requeueAnalysisJob,
  ANALYSIS_MAX_TRANSIENT_ATTEMPTS,
  ANALYSIS_RATE_LIMIT_DEFER_MS,
} from "./store";
import {
  createAnalysisTimingBucket,
  runWithAnalysisTiming,
} from "./timing";
import type { AnalysisJob, AnalysisJobMetrics } from "./types";
import { scheduleAnalysisDrainKick } from "./kick";
import {
  noteP2RateLimitHit,
  noteP2Success,
} from "./p2-concurrency";
import {
  isTransientLlmSaturationError,
  LLM_SATURATION_REQUEUE_MESSAGE,
  sanitizeAnalysisFailureMessage,
} from "@/lib/sanitize";

export type AnalysisJobWorkerDeps = {
  claimNext?: typeof claimNextAnalysisJob;
  complete?: typeof completeAnalysisJob;
  fail?: typeof failAnalysisJob;
  requeue?: typeof requeueAnalysisJob;
  heartbeat?: typeof heartbeatAnalysisJob;
  runP2?: (job: AnalysisJob) => Promise<Omit<AnalysisJobMetrics, "totalMs"> | void>;
  workerId?: string;
};

export type ProcessAnalysisJobOutcome =
  | "idle"
  | "completed"
  | "failed"
  | "requeued";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function measureMemorySyncMs(
  userId: string,
  historyId: string,
  maxWaitMs = 30_000,
): Promise<number | null> {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    try {
      const record = await getHistoryRecord(userId, historyId);
      if (record.memorySyncedAt) {
        return Math.max(0, Date.now() - started);
      }
      if (record.relationsPhase === "failed") {
        return Math.max(0, Date.now() - started);
      }
    } catch {
      return null;
    }
    await sleep(250);
  }
  return null;
}

async function defaultRunP2(
  job: AnalysisJob,
): Promise<Omit<AnalysisJobMetrics, "totalMs">> {
  const history = await getHistoryRecord(job.userId, job.historyId);
  const text = (history.extractedText ?? "").trim();
  if (!text) {
    throw new AppError(
      "BAD_REQUEST",
      "Texte d’analyse introuvable pour ce job (history).",
      400,
    );
  }

  const queueWaitMs = Math.max(
    0,
    Date.parse(job.startedAt ?? job.claimedAt ?? job.createdAt) -
      Date.parse(job.createdAt),
  );

  const timing = createAnalysisTimingBucket();
  const p2Started = Date.now();
  let full: Awaited<ReturnType<typeof analyzeDocumentText>>;
  try {
    full = await runWithAnalysisTiming(timing, () =>
      analyzeDocumentText({
        userId: job.userId,
        documentId: job.documentId,
        text,
        pages: job.pages,
        fileName: job.fileName,
        skipReadyReply: job.skipReadyReply,
      }),
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    Object.assign(err, {
      analysisJobMetrics: {
        queueWaitMs,
        lockWaitMs: timing.lockWaitMs,
        generateMs: timing.generateMs,
        historyMs: 0,
        memoryMs: null,
      } satisfies Omit<AnalysisJobMetrics, "totalMs">,
    });
    throw err;
  }

  if (!full.analysis || typeof full.analysis.document_type !== "string") {
    throw new AppError(
      "INTERNAL_ERROR",
      "Résultat P2 invalide (analysis manquante) — possible coalescence progressive.",
      500,
    );
  }
  if (!full.classification || typeof full.classification.category !== "string") {
    throw new AppError(
      "INTERNAL_ERROR",
      "Résultat P2 invalide (classification manquante).",
      500,
    );
  }

  // Contrat beta : salvage / fallback local ≠ succès LLM (pas de complete + mémoire).
  if (!isLlmAnalysisSuccess(full.resultSource)) {
    const fallbackNote =
      "Analyse LLM indisponible — fallback local explicite (non publié comme succès).";
    await updateHistoryRecord(job.userId, job.historyId, {
      classification: full.classification,
      analysis: {
        ...full.analysis,
        summary:
          full.analysis.summary?.startsWith("Analyse de secours")
            ? full.analysis.summary
            : `Analyse de secours (fallback local). ${full.analysis.summary || ""}`.trim(),
      },
      readyReply: full.readyReply ?? EMPTY_READY_REPLY,
      model: full.model,
      analyzedAt: full.analyzedAt,
      promptsUsed: full.promptsUsed,
      sheet: full.sheet
        ? {
            ...full.sheet,
            historyId: job.historyId,
            documentId: job.documentId,
            fileName: job.fileName,
            analyzedAt: full.analyzedAt,
          }
        : undefined,
      analysisPhase: "failed",
    }).catch(() => undefined);

    await trackAnalyticsEvent({
      name: "analysis.fallback",
      userId: job.userId,
      meta: {
        historyId: job.historyId,
        documentId: job.documentId,
        jobId: job.id,
        resultSource: full.resultSource ?? "salvage",
        publishedAsSuccess: false,
      },
    }).catch(() => undefined);

    throw new AppError("ANALYSIS_FAILED", fallbackNote, 502);
  }

  const p2DurationMs = full.durationMs ?? Date.now() - p2Started;
  const estimatedCostEur = estimateAnalysisCostEur({
    durationMs: p2DurationMs,
    totalTokens: full.totalTokens,
  });

  await trackAnalyticsEvent({
    name: "analysis.p2",
    userId: job.userId,
    meta: {
      historyId: job.historyId,
      documentId: job.documentId,
      jobId: job.id,
      durationMs: p2DurationMs,
      resultSource: full.resultSource ?? "agents",
      documentType: full.analysis.document_type,
      category: full.classification.category,
      categoryLabel: full.classification.label,
      totalTokens: full.totalTokens ?? 0,
      estimatedCostEur,
      lockWaitMs: timing.lockWaitMs,
      generateMs: timing.generateMs,
      ok: true,
    },
  });

  const totalDurationMs = (job.p1DurationMs ?? 0) + p2DurationMs;
  await trackAnalyticsEvent({
    name: "analysis.completed",
    userId: job.userId,
    meta: {
      historyId: job.historyId,
      documentId: job.documentId,
      jobId: job.id,
      durationMs: totalDurationMs,
      p1DurationMs: job.p1DurationMs ?? 0,
      p2DurationMs,
      resultSource: full.resultSource ?? "agents",
      documentType: full.analysis.document_type,
      category: full.classification.category,
      estimatedCostEur,
      mode: "queued",
    },
  });

  const historyStarted = Date.now();
  const updated = await updateHistoryRecord(job.userId, job.historyId, {
    classification: full.classification,
    analysis: full.analysis,
    readyReply: full.readyReply,
    model: full.model,
    analyzedAt: full.analyzedAt,
    promptsUsed: full.promptsUsed,
    sheet: full.sheet
      ? {
          ...full.sheet,
          historyId: job.historyId,
          documentId: job.documentId,
          fileName: job.fileName,
          analyzedAt: full.analyzedAt,
        }
      : undefined,
    analysisPhase: "complete",
  });
  const historyMs = Date.now() - historyStarted;

  await attachHistoryIdToLatestLog(
    job.userId,
    job.documentId,
    job.historyId,
  ).catch(() => undefined);

  await notifyAnalysisReady(job.userId, updated, {
    userEmail: job.userEmail,
  }).catch(() => undefined);

  await notifyForHistoryRecord(job.userId, updated, {
    userEmail: job.userEmail,
  }).catch(() => undefined);

  await appendMonitoringEvent({
    name: "analysis.ok",
    userId: job.userId,
    meta: {
      historyId: job.historyId,
      documentId: job.documentId,
      jobId: job.id,
      durationMs: p2DurationMs,
      mode: "queued",
    },
  }).catch(() => undefined);

  const memoryMs = await measureMemorySyncMs(job.userId, job.historyId);

  return {
    queueWaitMs,
    lockWaitMs: timing.lockWaitMs,
    generateMs: timing.generateMs,
    historyMs,
    memoryMs,
    totalTokens: full.totalTokens ?? 0,
  };
}

/**
 * Traite au plus un job (claim → P2 → complete / requeue / fail).
 */
export async function processOneAnalysisJob(
  deps: AnalysisJobWorkerDeps = {},
): Promise<ProcessAnalysisJobOutcome> {
  const workerId = deps.workerId ?? `w-${randomUUID().slice(0, 8)}`;
  const claim = deps.claimNext ?? claimNextAnalysisJob;
  const complete = deps.complete ?? completeAnalysisJob;
  const fail = deps.fail ?? failAnalysisJob;
  const requeue = deps.requeue ?? requeueAnalysisJob;
  const heartbeat = deps.heartbeat ?? heartbeatAnalysisJob;
  const runP2 = deps.runP2 ?? defaultRunP2;

  const job = await claim(workerId);
  if (!job) return "idle";

  const beat = setInterval(() => {
    void heartbeat(job.id, workerId).catch(() => undefined);
  }, 30_000);

  const wallStarted = Date.now();
  try {
    const partial = await runP2(job);
    const metrics: AnalysisJobMetrics | undefined = partial
      ? {
          ...partial,
          totalMs: Date.now() - wallStarted + (partial.queueWaitMs || 0),
        }
      : undefined;
    if (metrics) {
      metrics.totalMs =
        metrics.queueWaitMs + Math.max(0, Date.now() - wallStarted);
    }
    await complete(job.id, metrics);
    await noteP2Success().catch(() => undefined);
    return "completed";
  } catch (error) {
    const message = sanitizeAnalysisFailureMessage(
      error instanceof Error ? error.message : "Erreur P2 inconnue",
    );
    const attached = (
      error as { analysisJobMetrics?: Omit<AnalysisJobMetrics, "totalMs"> }
    )?.analysisJobMetrics;
    const failMetrics: AnalysisJobMetrics | undefined = attached
      ? {
          ...attached,
          totalMs:
            attached.queueWaitMs + Math.max(0, Date.now() - wallStarted),
        }
      : {
          queueWaitMs: Math.max(
            0,
            Date.parse(job.startedAt ?? job.claimedAt ?? job.createdAt) -
              Date.parse(job.createdAt),
          ),
          lockWaitMs: 0,
          generateMs: 0,
          historyMs: 0,
          memoryMs: null,
          totalMs: Math.max(0, Date.now() - wallStarted),
        };

    const transient = isTransientLlmSaturationError(error);
    if (transient && job.attempts < ANALYSIS_MAX_TRANSIENT_ATTEMPTS) {
      console.warn(
        `[analysis-jobs] requeue after saturation job=${job.id} attempts=${job.attempts}`,
      );
      await noteP2RateLimitHit().catch(() => undefined);
      await requeue(
        job.id,
        LLM_SATURATION_REQUEUE_MESSAGE,
        ANALYSIS_RATE_LIMIT_DEFER_MS,
      );
      await trackAnalyticsEvent({
        name: "analysis.error",
        userId: job.userId,
        meta: {
          historyId: job.historyId,
          documentId: job.documentId,
          jobId: job.id,
          phase: "p2",
          errorCode: "OLLAMA_UNAVAILABLE",
          message: "requeued_rate_limit",
          attempts: job.attempts,
          ...failMetrics,
        },
      }).catch(() => undefined);
      // Cron / prochain drain après cooldown — pas d’échec UI.
      scheduleAnalysisDrainKick(1);
      return "requeued";
    }

    await trackAnalyticsEvent({
      name: "analysis.error",
      userId: job.userId,
      meta: {
        historyId: job.historyId,
        documentId: job.documentId,
        jobId: job.id,
        phase: "p2",
        errorCode: error instanceof AppError ? error.code : "ANALYSIS_FAILED",
        message: message.slice(0, 200),
        ...failMetrics,
      },
    }).catch(() => undefined);

    await updateHistoryRecord(job.userId, job.historyId, {
      analysisPhase: "failed",
    }).catch(() => undefined);

    await fail(job.id, message, failMetrics);
    return "failed";
  } finally {
    clearInterval(beat);
  }
}

/**
 * Drain limité — claim respecte la concurrence effective (max 3, throttle 1).
 * Stoppe après un requeue (cooldown TPM) pour laisser respirer Groq.
 */
export async function drainAnalysisJobs(
  maxJobs = 3,
  deps: AnalysisJobWorkerDeps = {},
): Promise<number> {
  let n = 0;
  for (let i = 0; i < maxJobs; i += 1) {
    const outcome = await processOneAnalysisJob(deps);
    if (outcome === "idle") break;
    if (outcome === "requeued") break;
    n += 1;
  }
  return n;
}
