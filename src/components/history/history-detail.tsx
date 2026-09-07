"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  analysisJobFailMessageFromLastError,
  analysisJobLongWaitHint,
  analysisJobPollTimeoutMessage,
  analysisJobProcessingHint,
  analysisJobQueuePositionLine,
  analysisJobSaturationWaitHint,
  analysisJobStatusBody,
  analysisJobStatusTitle,
  isAnalysisJobSaturationHint,
} from "@/components/documents/analysis-job-status-copy";
import { AnalysisResults } from "@/components/documents/analysis-results";
import { ExtractedTextPanel } from "@/components/documents/extracted-text-panel";
import { FolderSelect } from "@/components/folders/folder-select";
import { Alert, AnalysisSkeleton, Button, ProgressBar } from "@/components/ui";
import { ArrowLeftIcon, TrashIcon } from "@/components/ui/icons";
import {
  deleteHistoryItem,
  fetchAnalysisJob,
  fetchAnalysisJobByHistory,
  fetchHistoryRecord,
} from "@/lib/client";
import { formatDateTime } from "@/lib/format";
import type { HistoryRecord } from "@/types";

interface HistoryDetailProps {
  id: string;
}

export function HistoryDetail({ id }: HistoryDetailProps) {
  const router = useRouter();
  const [record, setRecord] = useState<HistoryRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [jobUiStatus, setJobUiStatus] = useState<
    "pending" | "processing" | "completed" | "failed" | null
  >(null);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [saturationWait, setSaturationWait] = useState(false);
  const [longWaitHint, setLongWaitHint] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const formatJobError = (lastError?: string | null) =>
    analysisJobFailMessageFromLastError(lastError);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      setJobError(null);
      stopPolling();

      try {
        const data = await fetchHistoryRecord(id);
        if (cancelled) return;
        setRecord(data);

        if (data.analysisPhase === "preview") {
          let jobId: string | undefined;
          try {
            const byHistory = await fetchAnalysisJobByHistory(id);
            jobId = byHistory.jobId;
            if (!cancelled) {
              setJobUiStatus(byHistory.status);
              setQueuePosition(
                byHistory.status === "pending" ? byHistory.queuePosition : null,
              );
              if (byHistory.status === "completed") {
                const refreshed = await fetchHistoryRecord(id);
                if (!cancelled) {
                  setRecord(refreshed);
                  setJobUiStatus("completed");
                }
                return;
              }
              if (byHistory.status === "failed") {
                setJobUiStatus("failed");
                setJobError(formatJobError(byHistory.lastError));
                return;
              }
            }
          } catch {
            // pas de job — aperçu seul
          }

          if (!jobId || cancelled) return;

          let attempts = 0;
          pollRef.current = setInterval(() => {
            attempts += 1;
            void (async () => {
              if (attempts > 50) {
                stopPolling();
                setJobError(analysisJobPollTimeoutMessage());
                return;
              }
              try {
                const job = await fetchAnalysisJob(jobId!);
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
                  stopPolling();
                  const refreshed = await fetchHistoryRecord(id);
                  setRecord(refreshed);
                  setJobUiStatus("completed");
                  setQueuePosition(null);
                  setSaturationWait(false);
                  setLongWaitHint(null);
                  return;
                }
                if (job.status === "failed") {
                  stopPolling();
                  setJobUiStatus("failed");
                  setQueuePosition(null);
                  setSaturationWait(false);
                  setLongWaitHint(null);
                  setJobError(formatJobError(job.lastError));
                  const refreshed = await fetchHistoryRecord(id);
                  setRecord(refreshed);
                }
              } catch {
                // retry jusqu’au plafond
              }
            })();
          }, 4000);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Impossible de charger cette analyse.",
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [id]);

  const handleDelete = async () => {
    const confirmed = window.confirm(
      "Supprimer définitivement cette analyse ?",
    );
    if (!confirmed) return;

    setIsDeleting(true);

    try {
      await deleteHistoryItem(id);
      router.push("/dashboard");
      router.refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Suppression impossible.",
      );
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="h-4 w-40 animate-shimmer rounded bg-[color-mix(in_oklab,var(--muted)_16%,transparent)]" />
          <div className="h-9 w-2/3 max-w-md animate-shimmer rounded bg-[color-mix(in_oklab,var(--muted)_16%,transparent)]" />
        </div>
        <AnalysisSkeleton />
      </div>
    );
  }

  if (error && !record) {
    return (
      <div className="space-y-4 text-left">
        <Alert tone="error" title="Analyse introuvable">
          {error}
        </Alert>
        <Link
          href="/historique"
          className="inline-flex items-center gap-2 text-sm text-[var(--accent)] hover:underline"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Retour à l’historique
        </Link>
      </div>
    );
  }

  if (!record) return null;

  const phase =
    record.analysisPhase === "preview"
      ? "preview"
      : record.analysisPhase === "failed"
        ? "preview"
        : "complete";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 text-left">
        <div>
          <p className="text-sm text-[var(--muted)]">
            <Link
              href="/historique"
              className="transition-colors hover:text-[var(--accent)]"
            >
              Historique
            </Link>
            {" / "}
            Analyse enregistrée
          </p>
          <h1 className="mt-2 font-display text-3xl text-[var(--foreground)] sm:text-4xl">
            {record.analysis.title || record.fileName}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {record.fileName} · analysé le {formatDateTime(record.analyzedAt)}
            {record.model ? ` · modèle ${record.model}` : ""}
          </p>
          {record.promptsUsed?.length ? (
            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
              Prompts :{" "}
              {record.promptsUsed
                .map((p) =>
                  p.source === "admin" && p.version != null
                    ? `${p.key}=v${p.version}`
                    : `${p.key}=code`,
                )
                .join(" · ")}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <FolderSelect
            historyId={record.id}
            value={record.folderId}
            className="w-full min-w-0 md:min-w-[200px] md:w-auto"
            onMoved={(folderId) => {
              setRecord((current) =>
                current ? { ...current, folderId } : current,
              );
            }}
          />
          <div className="flex items-center gap-2">
            <Link
              href="/historique"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              Retour
            </Link>
            <Button
              variant="danger"
              disabled={isDeleting}
              onClick={() => {
                void handleDelete();
              }}
            >
              <TrashIcon className="h-4 w-4" />
              {isDeleting ? "Suppression…" : "Supprimer"}
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <Alert tone="error" title="Erreur">
          {error}
        </Alert>
      ) : null}

      {jobUiStatus === "pending" || jobUiStatus === "processing" ? (
        <Alert
          tone="info"
          title={analysisJobStatusTitle(jobUiStatus)}
        >
          <div className="space-y-3">
            <div className="space-y-1">
              <p>{analysisJobStatusBody()}</p>
              {jobUiStatus === "pending" && queuePosition != null ? (
                <p className="text-sm opacity-90">
                  {analysisJobQueuePositionLine(queuePosition)}
                </p>
              ) : null}
              {jobUiStatus === "processing" ? (
                <p className="text-sm opacity-90">
                  {analysisJobProcessingHint()}
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
            </div>
            <ProgressBar
              indeterminate
              label="Analyse approfondie (risques, citations…)"
            />
          </div>
        </Alert>
      ) : null}

      {jobUiStatus === "failed" || record.analysisPhase === "failed" ? (
        <Alert tone="error" title="L’analyse n’a pas pu aboutir">
          <div className="space-y-2">
            <p>
              {jobError ||
                "L’aperçu reste disponible. Vous pouvez relancer l’analyse depuis la page Analyser."}
            </p>
            <Link
              href="/analyser"
              className="inline-flex text-sm font-medium text-[var(--accent)] underline-offset-2 hover:underline"
            >
              Réessayer depuis Analyser
            </Link>
          </div>
        </Alert>
      ) : null}

      <AnalysisResults
        analysis={record.analysis}
        classification={record.classification}
        readyReply={record.readyReply}
        sheet={record.sheet}
        historyId={record.id}
        documentId={record.documentId}
        relationsPhase={record.relationsPhase}
        phase={phase}
        backgroundPending={
          jobUiStatus === "pending" || jobUiStatus === "processing"
        }
        onLetterDrafted={(letter) => {
          setRecord((current) =>
            current ? { ...current, readyReply: letter } : current,
          );
        }}
      />

      <ExtractedTextPanel
        extraction={{
          documentId: record.documentId,
          text: record.extractedText,
          pageCount: 1,
          pages: record.extractedText ? [record.extractedText] : [],
        }}
        fileName={record.fileName}
      />
    </div>
  );
}
