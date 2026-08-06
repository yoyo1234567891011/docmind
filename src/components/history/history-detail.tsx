"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AnalysisResults } from "@/components/documents/analysis-results";
import { ExtractedTextPanel } from "@/components/documents/extracted-text-panel";
import { FolderSelect } from "@/components/folders/folder-select";
import { Alert, AnalysisSkeleton, Button } from "@/components/ui";
import { ArrowLeftIcon, TrashIcon } from "@/components/ui/icons";
import { deleteHistoryItem, fetchHistoryRecord } from "@/lib/client";
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

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const data = await fetchHistoryRecord(id);
        if (!cancelled) setRecord(data);
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
      router.push("/historique");
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
            className="min-w-[200px]"
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

      <AnalysisResults
        analysis={record.analysis}
        classification={record.classification}
        readyReply={record.readyReply}
        sheet={record.sheet}
        historyId={record.id}
        documentId={record.documentId}
        relationsPhase={record.relationsPhase}
        phase={record.analysisPhase === "preview" ? "preview" : "complete"}
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
