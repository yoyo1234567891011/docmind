import { after } from "next/server";

import { ensureOllamaReachable } from "@/ai/models/client";
import { getOllamaBaseUrl } from "@/ai/models/config";
import {
  analyzeDocumentText,
  documentAnalysisLockKey,
  quickAnalyzeDocumentText,
  withDocumentAnalysisSingleFlight,
} from "@/ai/pipelines";
import { estimateAnalysisCostEur } from "@/config/analytics";
import { assertSafeResourceId } from "@/config/paths";
import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { checkRateLimitAsync, pruneRateLimitBuckets } from "@/lib/rate-limit";
import { trackAnalyticsEvent } from "@/services/analytics";
import { hasEntitlement } from "@/services/billing/entitlements";
import {
  saveHistoryRecord,
  updateHistoryRecord,
} from "@/services/history";
import { attachHistoryIdToLatestLog } from "@/services/logs";
import { appendMonitoringEvent } from "@/services/monitoring/store";
import {
  notifyAnalysisReady,
  notifyForHistoryRecord,
} from "@/services/notifications";
import { consumeQuota } from "@/services/quotas/enforce";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Limite texte analysé (défense DoS) — ~upload PDF 10 Mo. */
const MAX_ANALYZE_TEXT_CHARS = 1_500_000;
const MAX_ANALYZE_PAGES = 200;

async function runFullAnalysisInBackground(input: {
  userId: string;
  userEmail?: string | null;
  historyId: string;
  documentId: string;
  text: string;
  pages?: string[];
  fileName: string;
  skipReadyReply: boolean;
  p1DurationMs?: number;
}): Promise<void> {
  const p2Started = Date.now();
  try {
    const full = await analyzeDocumentText({
      userId: input.userId,
      documentId: input.documentId,
      text: input.text,
      pages: input.pages,
      fileName: input.fileName,
      skipReadyReply: input.skipReadyReply,
    });

    const p2DurationMs = full.durationMs ?? Date.now() - p2Started;
    const estimatedCostEur = estimateAnalysisCostEur({
      durationMs: p2DurationMs,
      totalTokens: full.totalTokens,
    });

    await trackAnalyticsEvent({
      name: "analysis.p2",
      userId: input.userId,
      meta: {
        historyId: input.historyId,
        documentId: input.documentId,
        durationMs: p2DurationMs,
        resultSource: full.resultSource ?? "agents",
        documentType: full.analysis.document_type,
        category: full.classification.category,
        categoryLabel: full.classification.label,
        totalTokens: full.totalTokens ?? 0,
        estimatedCostEur,
        ok: true,
      },
    });

    if (full.resultSource === "salvage") {
      await trackAnalyticsEvent({
        name: "analysis.fallback",
        userId: input.userId,
        meta: {
          historyId: input.historyId,
          documentId: input.documentId,
          durationMs: p2DurationMs,
          documentType: full.analysis.document_type,
        },
      });
    }

    const totalDurationMs =
      (input.p1DurationMs ?? 0) + p2DurationMs;
    await trackAnalyticsEvent({
      name: "analysis.completed",
      userId: input.userId,
      meta: {
        historyId: input.historyId,
        documentId: input.documentId,
        durationMs: totalDurationMs,
        p1DurationMs: input.p1DurationMs ?? 0,
        p2DurationMs,
        resultSource: full.resultSource ?? "agents",
        documentType: full.analysis.document_type,
        category: full.classification.category,
        estimatedCostEur,
        mode: "progressive",
      },
    });

    const updated = await updateHistoryRecord(input.userId, input.historyId, {
      classification: full.classification,
      analysis: full.analysis,
      readyReply: full.readyReply,
      model: full.model,
      analyzedAt: full.analyzedAt,
      promptsUsed: full.promptsUsed,
      sheet: full.sheet
        ? {
            ...full.sheet,
            historyId: input.historyId,
            documentId: input.documentId,
            fileName: input.fileName,
            analyzedAt: full.analyzedAt,
          }
        : undefined,
      analysisPhase: "complete",
    });

    await attachHistoryIdToLatestLog(
      input.userId,
      input.documentId,
      input.historyId,
    ).catch(() => undefined);

    await notifyAnalysisReady(input.userId, updated, {
      userEmail: input.userEmail,
    }).catch(() => undefined);

    await notifyForHistoryRecord(input.userId, updated, {
      userEmail: input.userEmail,
    }).catch(() => undefined);

    await appendMonitoringEvent({
      name: "analysis.ok",
      userId: input.userId,
      meta: {
        historyId: input.historyId,
        documentId: input.documentId,
        durationMs: p2DurationMs,
        mode: "progressive",
      },
    }).catch(() => undefined);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur P2 inconnue";
    await trackAnalyticsEvent({
      name: "analysis.error",
      userId: input.userId,
      meta: {
        historyId: input.historyId,
        documentId: input.documentId,
        phase: "p2",
        durationMs: Date.now() - p2Started,
        errorCode:
          error instanceof AppError ? error.code : "ANALYSIS_FAILED",
        message: message.slice(0, 200),
      },
    });
    await appendMonitoringEvent({
      name: "analysis.error",
      userId: input.userId,
      meta: {
        historyId: input.historyId,
        documentId: input.documentId,
        phase: "p2",
        message: message.slice(0, 200),
      },
    }).catch(() => undefined);
    await updateHistoryRecord(input.userId, input.historyId, {
      analysisPhase: "failed",
    }).catch(() => undefined);
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const { chaosGate } = await import("@/lib/chaos");
    await chaosGate("connection_cut");
    pruneRateLimitBuckets();
    const limited = await checkRateLimitAsync({
      key: `analyze:${user.id}`,
      limit: 20,
      windowMs: 60 * 60 * 1000,
    });
    if (!limited.ok) {
      throw new AppError(
        "BAD_REQUEST",
        `Trop d’analyses. Réessayez dans ${limited.retryAfterSec}s.`,
        429,
      );
    }

    await ensureOllamaReachable(getOllamaBaseUrl()).catch(() => undefined);
    const body = (await request.json()) as {
      documentId?: unknown;
      text?: unknown;
      pages?: unknown;
      fileName?: unknown;
      skipReadyReply?: unknown;
      skipHistory?: unknown;
      onInFlight?: unknown;
      /** progressive = P1 locale sync + P2 juridique async ; full = P2 sync (défaut scripts) */
      mode?: unknown;
    };

    if (typeof body.documentId !== "string" || !body.documentId.trim()) {
      throw new AppError("BAD_REQUEST", 'Le champ "documentId" est requis.');
    }
    const documentId = assertSafeResourceId(body.documentId, "documentId");

    if (typeof body.text !== "string") {
      throw new AppError("BAD_REQUEST", 'Le champ "text" est requis.');
    }
    if (body.text.length > MAX_ANALYZE_TEXT_CHARS) {
      throw new AppError(
        "BAD_REQUEST",
        `Texte trop volumineux (max ${MAX_ANALYZE_TEXT_CHARS} caractères).`,
        413,
      );
    }
    const text = body.text;

    const fileName =
      typeof body.fileName === "string" && body.fileName.trim()
        ? body.fileName.trim()
        : "document.pdf";

    let skipReadyReply =
      body.skipReadyReply === true
        ? true
        : body.skipReadyReply === false
          ? false
          : undefined;
    // Défense en profondeur : Free ne peut pas forcer la génération courrier via analyze.
    if (skipReadyReply === false) {
      const canLetter = await hasEntitlement(user.id, "letter_agent", {
        reconcile: true,
      });
      if (!canLetter) skipReadyReply = true;
    }
    const skipHistory = body.skipHistory === true;
    const progressive = body.mode === "progressive";
    const onInFlight =
      body.onInFlight === "status"
        ? ("status" as const)
        : body.onInFlight === "wait"
          ? ("wait" as const)
          : undefined;

    const pages = Array.isArray(body.pages)
      ? body.pages.filter(
          (p): p is string => typeof p === "string" && p.trim().length > 0,
        )
      : undefined;
    if (pages && pages.length > MAX_ANALYZE_PAGES) {
      throw new AppError(
        "BAD_REQUEST",
        `Trop de pages (max ${MAX_ANALYZE_PAGES}).`,
        413,
      );
    }

    await trackAnalyticsEvent({
      name: "analysis.started",
      userId: user.id,
      meta: {
        documentId,
        fileName,
        mode: progressive ? "progressive" : "full",
        textChars: text.length,
        pageCount: pages?.length ?? 0,
      },
    });

    const flightKey = documentAnalysisLockKey(user.id, documentId);

    if (progressive) {
      // Single-flight + quota leader-only : évite double historique / double quota.
      const { result: progressivePayload } =
        await withDocumentAnalysisSingleFlight(flightKey, async () => {
          await consumeQuota(user.id, "analyze");

          const p1Started = Date.now();
          const preview = await quickAnalyzeDocumentText({
            userId: user.id,
            documentId,
            text,
            pages,
            fileName,
            skipReadyReply: true,
          });
          const p1DurationMs = Date.now() - p1Started;

          await trackAnalyticsEvent({
            name: "analysis.p1",
            userId: user.id,
            meta: {
              documentId,
              durationMs: p1DurationMs,
              documentType: preview.analysis.document_type,
              category: preview.classification.category,
              categoryLabel: preview.classification.label,
              textChars: text.length,
            },
          });

          if (skipHistory) {
            return {
              kind: "preview-only" as const,
              preview,
              p1DurationMs,
            };
          }

          try {
            const historyRecord = await saveHistoryRecord(user.id, {
              result: preview,
              fileName,
              extractedText: text,
            });

            after(() => {
              void runFullAnalysisInBackground({
                userId: user.id,
                userEmail: user.email,
                historyId: historyRecord.id,
                documentId,
                text,
                pages,
                fileName,
                skipReadyReply: skipReadyReply ?? true,
                p1DurationMs,
              }).catch((error) => {
                console.error(
                  `[analyze] progressive background failed historyId=${historyRecord.id}`,
                  error instanceof Error ? error.message : error,
                );
              });
            });

            return {
              kind: "with-history" as const,
              preview,
              historyId: historyRecord.id,
              sheet: historyRecord.sheet,
              p1DurationMs,
            };
          } catch {
            return {
              kind: "preview-only" as const,
              preview,
              p1DurationMs,
            };
          }
        });

      if (progressivePayload.kind === "with-history") {
        return apiSuccess({
          ...progressivePayload.preview,
          historyId: progressivePayload.historyId,
          sheet: progressivePayload.sheet,
          notificationsCreated: 0,
          durationMs: progressivePayload.p1DurationMs,
        });
      }
      return apiSuccess({
        ...progressivePayload.preview,
        notificationsCreated: 0,
        durationMs: progressivePayload.p1DurationMs,
      });
    }

    const fullStarted = Date.now();
    let result;
    try {
      result = await analyzeDocumentText({
        userId: user.id,
        documentId,
        text,
        pages,
        fileName,
        skipReadyReply: skipReadyReply ?? true,
        onInFlight,
        beforeLeaderRun: async () => {
          await consumeQuota(user.id, "analyze");
        },
      });
    } catch (error) {
      await appendMonitoringEvent({
        name: "analysis.error",
        userId: user.id,
        meta: {
          documentId,
          message: error instanceof Error ? error.message.slice(0, 200) : "error",
        },
      }).catch(() => undefined);
      throw error;
    }

    const p2DurationMs = result.durationMs ?? Date.now() - fullStarted;
    await appendMonitoringEvent({
      name: "analysis.ok",
      userId: user.id,
      meta: {
        documentId,
        durationMs: p2DurationMs,
        resultSource: result.resultSource ?? "agents",
      },
    }).catch(() => undefined);
    const estimatedCostEur = estimateAnalysisCostEur({
      durationMs: p2DurationMs,
      totalTokens: result.totalTokens,
    });

    await trackAnalyticsEvent({
      name: "analysis.p2",
      userId: user.id,
      meta: {
        documentId,
        durationMs: p2DurationMs,
        resultSource: result.resultSource ?? "agents",
        documentType: result.analysis.document_type,
        category: result.classification.category,
        categoryLabel: result.classification.label,
        totalTokens: result.totalTokens ?? 0,
        estimatedCostEur,
        ok: true,
        mode: "full",
      },
    });

    if (result.resultSource === "salvage") {
      await trackAnalyticsEvent({
        name: "analysis.fallback",
        userId: user.id,
        meta: {
          documentId,
          durationMs: p2DurationMs,
          documentType: result.analysis.document_type,
        },
      });
    }

    await trackAnalyticsEvent({
      name: "analysis.completed",
      userId: user.id,
      meta: {
        documentId,
        durationMs: p2DurationMs,
        p2DurationMs,
        resultSource: result.resultSource ?? "agents",
        documentType: result.analysis.document_type,
        category: result.classification.category,
        estimatedCostEur,
        mode: "full",
      },
    });

    if (skipHistory) {
      return apiSuccess({
        ...result,
        phase: "complete" as const,
        durationMs: p2DurationMs,
      });
    }

    try {
      const historyRecord = await saveHistoryRecord(user.id, {
        result: { ...result, phase: "complete" },
        fileName,
        extractedText: text,
      });

      await attachHistoryIdToLatestLog(
        user.id,
        result.documentId,
        historyRecord.id,
      ).catch(() => undefined);

      const notifications = await notifyForHistoryRecord(
        user.id,
        historyRecord,
        { userEmail: user.email },
      ).catch(() => []);

      return apiSuccess({
        ...result,
        phase: "complete" as const,
        historyId: historyRecord.id,
        sheet: historyRecord.sheet,
        notificationsCreated: notifications.length,
        durationMs: p2DurationMs,
      });
    } catch {
      return apiSuccess({
        ...result,
        phase: "complete" as const,
        notificationsCreated: 0,
        durationMs: p2DurationMs,
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur d'analyse";
    await trackAnalyticsEvent({
      name: "analysis.error",
      meta: {
        phase: "request",
        errorCode: error instanceof AppError ? error.code : "INTERNAL_ERROR",
        message,
      },
    }).catch(() => undefined);
    return apiFromUnknownError(error);
  }
}
