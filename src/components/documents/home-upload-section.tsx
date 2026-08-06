"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { ExtractedTextPanel } from "@/components/documents/extracted-text-panel";
import { PdfDropzone } from "@/components/documents/pdf-dropzone";
import {
  Alert,
  AnalysisProgress,
  AnalysisSkeleton,
  type AnalysisStepId,
} from "@/components/ui";

const AnalysisResults = dynamic(
  () =>
    import("@/components/documents/analysis-results").then((m) => ({
      default: m.AnalysisResults,
    })),
  { loading: () => <AnalysisSkeleton /> },
);
import { analyzeDocument, fetchHistoryRecord } from "@/lib/client";
import { trackClientAnalytics } from "@/lib/client/analytics";
import { buildReportHref } from "@/lib/client/beta";
import type { AnalyzeDocumentResult, UploadPdfResult } from "@/types";

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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingHistoryRef = useRef<string | null>(null);
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
      // Si P2 encore en cours au démontage → abandon
      if (pendingHistoryRef.current) {
        trackAbandon("navigate_away");
      }
      stopPolling();
    },
    [],
  );

  const resetAnalysis = () => {
    stopPolling();
    pendingHistoryRef.current = null;
    setAnalysisResult(null);
    setAnalysisStatus("idle");
    setAnalysisError(null);
    setBackgroundPending(false);
  };

  const startPollingFullAnalysis = (historyId: string) => {
    stopPolling();
    pendingHistoryRef.current = historyId;
    abandonSentRef.current = false;
    setBackgroundPending(true);
    let attempts = 0;
    let consecutiveErrors = 0;
    const MAX_ATTEMPTS = 120; // ~8 min
    const MAX_CONSECUTIVE_ERRORS = 8;

    const finishPending = () => {
      stopPolling();
      setBackgroundPending(false);
    };

    pollRef.current = setInterval(() => {
      attempts += 1;
      void (async () => {
        // Toujours plafonner — même si l’historique est inaccessible
        if (attempts > MAX_ATTEMPTS) {
          finishPending();
          trackAbandon("poll_timeout", historyId);
          setAnalysisError(
            "L’analyse approfondie prend plus de temps que prévu. L’aperçu reste disponible — rouvrez le document depuis l’historique dans quelques minutes, ou relancez l’analyse.",
          );
          return;
        }

        try {
          const record = await fetchHistoryRecord(historyId);
          consecutiveErrors = 0;
          if (
            record.analysisPhase === "complete" ||
            record.analysisPhase === "failed"
          ) {
            finishPending();
            if (record.analysisPhase === "complete") {
              pendingHistoryRef.current = null;
              setAnalysisResult((current) =>
                current
                  ? {
                      ...current,
                      classification: record.classification,
                      analysis: record.analysis,
                      readyReply: record.readyReply,
                      model: record.model,
                      analyzedAt: record.analyzedAt,
                      sheet: record.sheet,
                      phase: "complete",
                      historyId: record.id,
                    }
                  : current,
              );
            } else {
              pendingHistoryRef.current = null;
              setAnalysisError(
                "L’analyse approfondie a échoué. L’aperçu reste disponible — réessayez plus tard.",
              );
              trackAbandon("p2_failed", historyId);
            }
          }
        } catch {
          consecutiveErrors += 1;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            finishPending();
            trackAbandon("poll_history_unreachable", historyId);
            setAnalysisError(
              "Impossible de suivre l’analyse en cours (historique indisponible). L’aperçu reste affiché — rouvrez le document depuis l’historique, ou réessayez.",
            );
          }
        }
      })();
    }, 4000);
  };

  const runAnalysis = async (result: UploadPdfResult) => {
    setUploadResult(result);
    setAnalysisResult(null);
    setAnalysisError(null);
    setAnalysisStatus("loading");
    setBackgroundPending(false);
    stopPolling();

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
      if (analysis.phase === "preview" && analysis.historyId) {
        startPollingFullAnalysis(analysis.historyId);
      }
    } catch (error) {
      setAnalysisStatus("error");
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
      : analysisStatus === "loading"
        ? "analyze"
        : uploadStatus === "success" && analysisStatus === "idle"
          ? "extract"
          : "reply";

  const showProgress =
    uploadStatus === "uploading" || analysisStatus === "loading";

  return (
    <div className="flex w-full flex-col gap-5">
      <PdfDropzone
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
        <Alert tone="error" title="Analyse impossible pour l’instant">
          <div className="space-y-2">
            <p>{analysisError}</p>
            <div className="flex flex-wrap gap-3 text-sm">
              <button
                type="button"
                className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
                onClick={() => {
                  if (uploadResult) void runAnalysis(uploadResult);
                }}
              >
                Réessayer
              </button>
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
            </div>
          </div>
        </Alert>
      ) : null}

      {analysisStatus === "loading" ? <AnalysisSkeleton /> : null}

      {analysisResult ? (
        <div className="space-y-4">
          {backgroundPending ? (
            <Alert tone="info" title="Aperçu prêt — analyse juridique en cours">
              <p>
                Extraction locale affichée immédiatement (faits, dates, montants,
                personnes). L’analyse juridique continue en arrière-plan ; une
                notification apparaîtra quand elle sera prête.
              </p>
            </Alert>
          ) : null}

          {analysisResult.phase === "complete" && analysisResult.historyId ? (
            <Alert tone="success" title="Analyse complète enregistrée">
              <Link
                href={`/historique/${analysisResult.historyId}`}
                className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
              >
                Voir dans l’historique
              </Link>
            </Alert>
          ) : analysisResult.historyId && !backgroundPending ? (
            <Alert tone="success" title="Analyse enregistrée">
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
