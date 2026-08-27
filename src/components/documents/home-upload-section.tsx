"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import {
  analysisJobPollTimeoutMessage,
  analysisJobProcessingHint,
  analysisJobQueuePositionLine,
  analysisJobLongWaitHint,
  analysisJobSaturationFailMessage,
  analysisJobSaturationWaitHint,
  analysisJobStatusBody,
  analysisJobStatusTitle,
  analysisLoadingShortMessage,
  isAnalysisJobSaturationHint,
} from "@/components/documents/analysis-job-status-copy";
import { AnalysisQuotaBanner } from "@/components/documents/analysis-quota-banner";
import { ExtractedTextPanel } from "@/components/documents/extracted-text-panel";
import { PdfDropzone } from "@/components/documents/pdf-dropzone";
import {
  Alert,
  AnalysisProgress,
  AnalysisSkeleton,
  ProgressBar,
  type AnalysisStepId,
} from "@/components/ui";

const AnalysisResults = dynamic(
  () =>
    import("@/components/documents/analysis-results").then((m) => ({
      default: m.AnalysisResults,
    })),
  { loading: () => <AnalysisSkeleton /> },
);
import {
  analyzeDocument,
  fetchAnalysisJob,
  fetchHistoryRecord,
  fetchQuotas,
  type QuotaStatus,
} from "@/lib/client";
import { isQuotaExceededError } from "@/lib/client/api-error";
import { trackClientAnalytics } from "@/lib/client/analytics";
import { buildReportHref } from "@/lib/client/beta";
import {
  clearPendingAnalysis,
  readPendingAnalysis,
  savePendingAnalysis,
} from "@/lib/client/pending-analysis";
import { markDashboardStale } from "@/lib/client/dashboard-sync";
import {
  classifyExtractedTextQuality,
  extractionQualityMessage,
  NO_EXTRACTABLE_TEXT_MESSAGE,
} from "@/services/pdf/text-sufficiency";
import type { AnalyzeDocumentResult, HistoryRecord, UploadPdfResult } from "@/types";

function resultFromHistory(
  record: HistoryRecord,
  extras?: Partial<AnalyzeDocumentResult>,
): AnalyzeDocumentResult {
  return {
    classification: record.classification,
    analysis: record.analysis,
    readyReply: record.readyReply,
    model: record.model,
    analyzedAt: record.analyzedAt,
    promptsUsed: record.promptsUsed ?? [],
    sheet: record.sheet,
    phase: record.analysisPhase === "complete" ? "complete" : "preview",
    historyId: record.id,
    documentId: record.documentId,
    ...extras,
  };
}

type AnalysisStatus = "idle" | "loading" | "success" | "error";
type UploadStatus = "idle" | "uploading" | "success" | "error";

export function HomeUploadSection() {
  const [uploadResult, setUploadResult] = useState<UploadPdfResult | null>(
    null,
  );
  const [analysisResult, setAnalysisResult] =
    useState<AnalyzeDocumentResult | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>("idle");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [backgroundPending, setBackgroundPending] = useState(false);
  const [jobUiStatus, setJobUiStatus] = useState<
    "pending" | "processing" | "completed" | "failed" | null
  >(null);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [saturationWait, setSaturationWait] = useState(false);
  const [longWaitHint, setLongWaitHint] = useState<string | null>(null);
  const [quotas, setQuotas] = useState<QuotaStatus | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingHistoryRef = useRef<string | null>(null);
  const pendingJobRef = useRef<string | null>(null);
  const abandonSentRef = useRef(false);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const trackAbandon = (reason: string, historyId?: string | null) => {
    const id = historyId ?? pendingHistoryRef.current;
    if (!id || abandonSentRef.current) return;
    abandonSentRef.current = true;
    void trackClientAnalytics("analysis.abandon", {
      historyId: id,
      reason,
    });
  };

  useEffect(
    () => () => {
      // Naviguer ailleurs n’annule pas le job serveur — analytics seulement.
      if (pendingHistoryRef.current) {
        trackAbandon("navigate_away");
      }
      stopPolling();
    },
    [],
  );

  const refreshQuotas = () => {
    void fetchQuotas()
      .then(setQuotas)
      .catch(() => setQuotas(null));
  };

  useEffect(() => {
    refreshQuotas();
  }, []);

  const analyzeQuota = quotas?.items.find((i) => i.metric === "analyze");
  const analyzeRemaining =
    analyzeQuota?.unlimited === true
      ? Number.POSITIVE_INFINITY
      : (analyzeQuota?.remaining ?? Number.POSITIVE_INFINITY);
  const analyzeQuotaExhausted =
    Number.isFinite(analyzeRemaining) && analyzeRemaining <= 0;

  useEffect(() => {
    if (!backgroundPending) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [backgroundPending]);

  const resetAnalysis = () => {
    stopPolling();
    pendingHistoryRef.current = null;
    pendingJobRef.current = null;
    clearPendingAnalysis();
    setAnalysisResult(null);
    setAnalysisStatus("idle");
    setAnalysisError(null);
    setQuotaExceeded(false);
    setBackgroundPending(false);
    setJobUiStatus(null);
    setQueuePosition(null);
  };

  const startPollingFullAnalysis = (input: {
    historyId: string;
    jobId?: string;
    documentId?: string;
    fileName?: string;
  }) => {
    stopPolling();
    pendingHistoryRef.current = input.historyId;
    pendingJobRef.current = input.jobId ?? null;
    abandonSentRef.current = false;
    savePendingAnalysis({
      historyId: input.historyId,
      jobId: input.jobId,
      documentId: input.documentId,
      fileName: input.fileName,
    });
    setBackgroundPending(true);
    setJobUiStatus(input.jobId ? "pending" : "processing");
    setQueuePosition(null);
    setLongWaitHint(null);
    let attempts = 0;
    let consecutiveErrors = 0;
    const MAX_ATTEMPTS = 120; // ~8 min
    const MAX_CONSECUTIVE_ERRORS = 8;

    const finishPending = () => {
      stopPolling();
      setBackgroundPending(false);
      setQueuePosition(null);
    };

    const applyCompletedHistory = async (historyId: string) => {
      const record = await fetchHistoryRecord(historyId);
      const doneJobId = pendingJobRef.current ?? undefined;
      pendingHistoryRef.current = null;
      pendingJobRef.current = null;
      clearPendingAnalysis();
      setJobUiStatus("completed");
      setAnalysisResult((current) =>
        resultFromHistory(record, {
          phase: "complete",
          jobId: current?.jobId ?? doneJobId,
          jobStatus: "completed",
          documentId: record.documentId || current?.documentId || "",
        }),
      );
      markDashboardStale("analysis");
    };

    pollRef.current = setInterval(() => {
      attempts += 1;
      void (async () => {
        // Timeout client = arrêt du polling uniquement — le job PG reste.
        if (attempts > MAX_ATTEMPTS) {
          finishPending();
          trackAbandon("poll_timeout", input.historyId);
          setAnalysisError(analysisJobPollTimeoutMessage());
          return;
        }

        try {
          const jobId = pendingJobRef.current;
          if (jobId) {
            const job = await fetchAnalysisJob(jobId);
            consecutiveErrors = 0;
            setJobUiStatus(job.status);
            setQueuePosition(
              job.status === "pending" ? job.queuePosition : null,
            );
            setSaturationWait(
              (job.status === "pending" || job.status === "processing") &&
                isAnalysisJobSaturationHint(job.lastError),
            );
            setLongWaitHint(
              job.status === "pending" || job.status === "processing"
                ? analysisJobLongWaitHint(job.attempts)
                : null,
            );

            if (job.status === "completed") {
              finishPending();
              setSaturationWait(false);
              setLongWaitHint(null);
              await applyCompletedHistory(job.historyId || input.historyId);
              return;
            }
            if (job.status === "failed") {
              finishPending();
              setSaturationWait(false);
              setLongWaitHint(null);
              pendingHistoryRef.current = null;
              pendingJobRef.current = null;
              clearPendingAnalysis();
              setJobUiStatus("failed");
              setAnalysisError(
                job.lastError?.trim()
                  ? isAnalysisJobSaturationHint(job.lastError)
                    ? analysisJobSaturationFailMessage()
                    : `L’analyse approfondie a échoué : ${job.lastError}`
                  : "L’analyse approfondie a échoué. L’aperçu reste disponible — réessayez plus tard.",
              );
              trackAbandon("p2_failed", input.historyId);
              return;
            }
            // pending / processing — source de vérité = job API
            return;
          }

          // Fallback legacy sans jobId
          const record = await fetchHistoryRecord(input.historyId);
          consecutiveErrors = 0;
          if (
            record.analysisPhase === "complete" ||
            record.analysisPhase === "failed"
          ) {
            finishPending();
            if (record.analysisPhase === "complete") {
              await applyCompletedHistory(input.historyId);
            } else {
              pendingHistoryRef.current = null;
              clearPendingAnalysis();
              setJobUiStatus("failed");
              setAnalysisError(
                "L’analyse approfondie a échoué. L’aperçu reste disponible — réessayez plus tard.",
              );
              trackAbandon("p2_failed", input.historyId);
            }
          }
        } catch {
          consecutiveErrors += 1;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            finishPending();
            trackAbandon("poll_history_unreachable", input.historyId);
            setAnalysisError(
              "Impossible de suivre l’analyse en cours. L’aperçu reste affiché — le job n’est pas annulé ; rouvrez le document depuis l’historique, ou réessayez.",
            );
          }
        }
      })();
    }, 4000);
  };

  // Reprise après refresh : jobId/historyId en sessionStorage.
  useEffect(() => {
    let cancelled = false;
    const pending = readPendingAnalysis();
    if (!pending?.historyId) return;

    void (async () => {
      try {
        const record = await fetchHistoryRecord(pending.historyId);
        if (cancelled) return;

        if (record.analysisPhase === "complete") {
          clearPendingAnalysis();
          setAnalysisResult(
            resultFromHistory(record, {
              phase: "complete",
              jobId: pending.jobId,
              jobStatus: "completed",
            }),
          );
          setAnalysisStatus("success");
          setJobUiStatus("completed");
          return;
        }

        if (record.analysisPhase === "failed") {
          clearPendingAnalysis();
          setAnalysisResult(
            resultFromHistory(record, {
              phase: "preview",
              jobId: pending.jobId,
              jobStatus: "failed",
            }),
          );
          setAnalysisStatus("success");
          setJobUiStatus("failed");
          setAnalysisError(
            "L’analyse approfondie a échoué. L’aperçu reste disponible — réessayez plus tard.",
          );
          return;
        }

        setAnalysisResult(
          resultFromHistory(record, {
            phase: "preview",
            jobId: pending.jobId,
            jobStatus: pending.jobId ? "pending" : undefined,
          }),
        );
        setAnalysisStatus("success");
        startPollingFullAnalysis({
          historyId: record.id,
          jobId: pending.jobId,
          documentId: record.documentId,
          fileName: record.fileName,
        });
      } catch {
        // session stale — laisser l’UI idle
        clearPendingAnalysis();
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reprise une fois au mount
  }, []);

  const runAnalysis = async (result: UploadPdfResult) => {
    setUploadResult(result);
    setAnalysisResult(null);
    setAnalysisError(null);
    setBackgroundPending(false);
    stopPolling();

    const textQuality =
      result.extraction.textQuality ??
      classifyExtractedTextQuality(
        result.extraction.text,
        result.extraction.pageCount,
      );
    if (textQuality !== "ok") {
      setAnalysisStatus("error");
      setAnalysisError(extractionQualityMessage(textQuality));
      clearPendingAnalysis();
      return;
    }

    if (analyzeQuotaExhausted) {
      setAnalysisStatus("error");
      setQuotaExceeded(true);
      setAnalysisError(
        quotas?.plan === "free"
          ? `Vous avez utilisé vos ${analyzeQuota?.limit ?? 5} analyses du mois. Choisissez un plan pour continuer.`
          : "Quota d’analyses atteint pour ce mois. Passez à une offre supérieure.",
      );
      return;
    }

    setAnalysisStatus("loading");

    try {
      const analysis = await analyzeDocument(
        result.document.id,
        result.extraction.text,
        result.document.fileName,
        result.extraction.pages,
        { mode: "progressive" },
      );
      setAnalysisResult(analysis);
      setAnalysisStatus("success");
      refreshQuotas();
      if (analysis.phase === "preview" && analysis.historyId) {
        startPollingFullAnalysis({
          historyId: analysis.historyId,
          jobId: analysis.jobId,
          documentId: result.document.id,
          fileName: result.document.fileName,
        });
      } else {
        clearPendingAnalysis();
      }
    } catch (error) {
      setAnalysisStatus("error");
      if (isQuotaExceededError(error)) {
        setQuotaExceeded(true);
        refreshQuotas();
        setAnalysisError(error.message);
        return;
      }
      setAnalysisError(
        error instanceof Error
          ? error.message
          : "Échec de l'analyse du document.",
      );
    }
  };

  const currentStep: AnalysisStepId =
    uploadStatus === "uploading"
      ? "upload"
      : analysisStatus === "loading" || backgroundPending
        ? "analyze"
        : uploadStatus === "success" && analysisStatus === "idle"
          ? "extract"
          : "reply";

  const showProgress =
    uploadStatus === "uploading" ||
    analysisStatus === "loading" ||
    backgroundPending;

  return (
    <div className="flex w-full flex-col gap-5">
      {quotas ? <AnalysisQuotaBanner quotas={quotas} /> : null}

      <PdfDropzone
        disabled={analyzeQuotaExhausted}
        disabledMessage={
          analyzeQuotaExhausted
            ? quotas?.plan === "free"
              ? `Vous avez utilisé vos ${analyzeQuota?.limit ?? 5} analyses du mois. Choisissez un plan pour continuer.`
              : "Quota d’analyses atteint pour ce mois. Passez à une offre supérieure."
            : undefined
        }
        onStatusChange={setUploadStatus}
        onUploaded={(result) => {
          void runAnalysis(result);
        }}
        onCleared={() => {
          setUploadResult(null);
          setUploadStatus("idle");
          resetAnalysis();
        }}
      />

      {showProgress ? <AnalysisProgress currentStep={currentStep} /> : null}

      {analysisError ? (
        <Alert
          tone={
            analysisError === NO_EXTRACTABLE_TEXT_MESSAGE
              ? "info"
              : quotaExceeded
                ? "info"
                : "error"
          }
          title={
            analysisError === NO_EXTRACTABLE_TEXT_MESSAGE
              ? "Ce PDF ne contient pas de texte lisible"
              : quotaExceeded
                ? "Quota mensuel atteint"
                : jobUiStatus === "failed"
                  ? "L’analyse n’a pas pu aboutir"
                  : "Impossible d’analyser ce document"
          }
        >
          <div className="space-y-2">
            {analysisError === NO_EXTRACTABLE_TEXT_MESSAGE ? (
              <>
                <p>
                  Ce document semble être une image scannée ou ne contient pas
                  de texte extractible.
                </p>
                <p>
                  Pour l’instant, seuls les PDF avec du{" "}
                  <strong className="font-medium text-[var(--foreground)]">
                    texte sélectionnable
                  </strong>{" "}
                  sont supportés. Essayez un PDF natif (non scanné) ou une
                  version texte.
                </p>
                <p className="text-sm text-[var(--muted)]">
                  Votre fichier a bien été reçu. Supprimez-le ci-dessus, puis
                  uploadez un autre PDF.
                </p>
              </>
            ) : (
              <>
                <p>{analysisError}</p>
                {quotaExceeded && quotas?.plan === "free" ? (
                  <Link
                    href="/facturation"
                    className="inline-block font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                  >
                    Passer à un plan pour continuer
                  </Link>
                ) : null}
                {!quotaExceeded ? (
                  <p className="text-sm text-[var(--muted)]">
                    Vous pouvez réessayer : le document uploadé est conservé.
                  </p>
                ) : null}
              </>
            )}
            <div className="flex flex-wrap gap-3 text-sm">
              {uploadResult &&
              analysisError !== NO_EXTRACTABLE_TEXT_MESSAGE &&
              !quotaExceeded ? (
                <button
                  type="button"
                  className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                  onClick={() => {
                    if (uploadResult) void runAnalysis(uploadResult);
                  }}
                >
                  Réessayer l’analyse
                </button>
              ) : null}
              {analysisError !== NO_EXTRACTABLE_TEXT_MESSAGE ? (
                <Link
                  href={buildReportHref({
                    kind: "analysis",
                    message: "Erreur lors de l'analyse d'un PDF",
                    detail: analysisError,
                  })}
                  className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                >
                  Signaler le problème
                </Link>
              ) : null}
            </div>
          </div>
        </Alert>
      ) : null}

      {analysisStatus === "loading" ? (
        <div className="space-y-3">
          <Alert tone="info" title="Analyse en cours…">
            <p>{analysisLoadingShortMessage()}</p>
          </Alert>
          <AnalysisSkeleton />
        </div>
      ) : null}

      {analysisResult ? (
        <div className="space-y-4">
          {backgroundPending ? (
            <Alert
              tone="info"
              title={analysisJobStatusTitle(
                jobUiStatus === "pending" || jobUiStatus === "processing"
                  ? jobUiStatus
                  : "unknown",
              )}
            >
              <div className="space-y-3">
                <div className="space-y-1">
                  <p>{analysisJobStatusBody()}</p>
                  {jobUiStatus === "pending" && queuePosition != null ? (
                    <p className="text-sm opacity-90">
                      {analysisJobQueuePositionLine(queuePosition)}
                    </p>
                  ) : null}
                  {saturationWait ? (
                    <p className="text-sm opacity-90">
                      {analysisJobSaturationWaitHint()}
                    </p>
                  ) : null}
                  {longWaitHint ? (
                    <p className="text-sm opacity-90">{longWaitHint}</p>
                  ) : null}
                  {jobUiStatus === "processing" ? (
                    <p className="text-sm opacity-90">
                      {analysisJobProcessingHint()}
                    </p>
                  ) : null}
                </div>
                <ProgressBar
                  indeterminate
                  label="Analyse approfondie (risques, citations…)"
                />
              </div>
            </Alert>
          ) : null}

          {analysisResult.phase === "complete" && analysisResult.historyId ? (
            <Alert tone="success" title="Analyse terminée">
              <Link
                href={`/historique/${analysisResult.historyId}`}
                className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
              >
                Voir dans l’historique
              </Link>
            </Alert>
          ) : analysisResult.historyId &&
            !backgroundPending &&
            jobUiStatus !== "failed" &&
            !analysisError ? (
            <Alert tone="success" title="Aperçu disponible">
              <Link
                href={`/historique/${analysisResult.historyId}`}
                className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
              >
                Voir dans l’historique
              </Link>
            </Alert>
          ) : null}

          <AnalysisResults
            analysis={analysisResult.analysis}
            classification={analysisResult.classification}
            readyReply={analysisResult.readyReply}
            sheet={analysisResult.sheet}
            historyId={analysisResult.historyId}
            documentId={analysisResult.documentId}
            phase={analysisResult.phase === "preview" ? "preview" : "complete"}
            backgroundPending={backgroundPending}
            onLetterDrafted={(letter) => {
              setAnalysisResult((current) =>
                current ? { ...current, readyReply: letter } : current,
              );
            }}
          />
        </div>
      ) : null}

      {uploadResult ? (
        <ExtractedTextPanel
          extraction={uploadResult.extraction}
          fileName={uploadResult.document.fileName}
        />
      ) : null}
    </div>
  );
}
