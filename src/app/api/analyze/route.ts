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
import { saveHistoryRecord } from "@/services/history";
import { attachHistoryIdToLatestLog } from "@/services/logs";
import { appendMonitoringEvent } from "@/services/monitoring/store";
import { notifyForHistoryRecord } from "@/services/notifications";
import { consumeQuota } from "@/services/quotas/enforce";

export const runtime = "nodejs";
/** Hobby Vercel ≤ 300s ; Pro peut remonter à 480. */
export const maxDuration = 300;

/** Limite texte analysé (défense DoS) — ~upload PDF 10 Mo. */
const MAX_ANALYZE_TEXT_CHARS = 1_500_000;
const MAX_ANALYZE_PAGES = 30;

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

    const { hasSufficientExtractableText, extractionQualityMessage, classifyExtractedTextQuality } =
      await import("@/services/pdf/text-sufficiency");
    const pageCount = Array.isArray(body.pages)
      ? body.pages.filter(
          (p): p is string => typeof p === "string" && p.trim().length > 0,
        ).length
      : 0;
    const textQuality = classifyExtractedTextQuality(text, pageCount || 1);
    if (!hasSufficientExtractableText(text) || textQuality === "likely_scan") {
      throw new AppError(
        "UNSUPPORTED_FILE",
        extractionQualityMessage(textQuality),
        422,
      );
    }

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
        `Ce document dépasse la limite de ${MAX_ANALYZE_PAGES} pages. Réduisez le PDF ou scindez-le.`,
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
    /** Clé distincte de P2 : sinon Redis republie le payload progressive et le worker coalesce un faux résultat. */
    const progressiveFlightKey = `${flightKey}:progressive`;

    if (progressive) {
      // Single-flight + quota leader-only : évite double historique / double quota.
      const { result: progressivePayload } =
        await withDocumentAnalysisSingleFlight(progressiveFlightKey, async () => {
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

            const { enqueueAnalysisJob, drainAnalysisJobs, scheduleAnalysisDrainKick } =
              await import("@/services/analysis-jobs");
            const job = await enqueueAnalysisJob({
              userId: user.id,
              documentId,
              historyId: historyRecord.id,
              fileName,
              skipReadyReply: skipReadyReply ?? true,
              p1DurationMs,
              userEmail: user.email,
              pages,
            });

            // Drain inline + kick HTTP — double filet si cron externe down.
            after(async () => {
              try {
                await drainAnalysisJobs(3);
              } catch (drainError) {
                console.error(
                  "[analyze] inline drain after enqueue failed",
                  drainError instanceof Error ? drainError.message : drainError,
                );
              }
              scheduleAnalysisDrainKick(3);
            });

            return {
              kind: "with-history" as const,
              preview,
              historyId: historyRecord.id,
              jobId: job.id,
              jobStatus: job.status,
              sheet: historyRecord.sheet,
              p1DurationMs,
            };
          } catch (error) {
            console.error(
              "[analyze] progressive history/enqueue failed",
              error instanceof Error ? error.message : error,
            );
            throw new AppError(
              "INTERNAL_ERROR",
              "Impossible de planifier l’analyse approfondie. Réessayez dans un instant.",
              503,
            );
          }
        });

      if (progressivePayload.kind === "with-history") {
        return apiSuccess({
          ...progressivePayload.preview,
          historyId: progressivePayload.historyId,
          jobId: progressivePayload.jobId,
          jobStatus: progressivePayload.jobStatus,
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
