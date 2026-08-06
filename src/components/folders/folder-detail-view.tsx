"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { getRiskToneClass } from "@/components/dashboard/dashboard-panel";
import { FolderSelect } from "@/components/folders/folder-select";
import { Alert, HistoryListSkeleton } from "@/components/ui";
import { ArrowLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { fetchFolders, fetchHistory } from "@/lib/client";
import { formatDateTime, getRiskLevelLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  UNFILED_FOLDER_ID,
  type DocumentFolder,
  type HistoryListItem,
} from "@/types";

interface FolderDetailViewProps {
  folderId: string;
}

async function resolveFolder(
  folderId: string,
): Promise<DocumentFolder | null> {
  if (folderId === UNFILED_FOLDER_ID) {
    return {
      id: UNFILED_FOLDER_ID,
      name: "Non classés",
      description: "Documents non rangés dans un dossier",
      system: true,
      createdAt: "2020-01-01T00:00:00.000Z",
    };
  }

  const data = await fetchFolders();
  return data.folders.find((folder) => folder.id === folderId) ?? null;
}

export function FolderDetailView({ folderId }: FolderDetailViewProps) {
  const [folder, setFolder] = useState<DocumentFolder | null>(null);
  const [items, setItems] = useState<HistoryListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [folderInfo, historyItems] = await Promise.all([
        resolveFolder(folderId),
        fetchHistory({ folderId }),
      ]);

      if (!folderInfo) {
        throw new Error("Dossier introuvable.");
      }

      setFolder(folderInfo);
      setItems(historyItems);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible d'ouvrir ce dossier.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) {
    return <HistoryListSkeleton />;
  }

  if (error || !folder) {
    return (
      <div className="space-y-4">
        <Alert tone="error" title="Dossier introuvable">
          {error || "Ce dossier n'existe pas."}
        </Alert>
        <Link
          href="/dossiers"
          className="inline-flex items-center gap-2 text-sm text-[var(--accent)] hover:underline"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Retour aux dossiers
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 text-left">
        <div>
          <p className="text-sm text-[var(--muted)]">
            <Link href="/dossiers" className="hover:text-[var(--accent)]">
              Dossiers
            </Link>
            {" / "}
            {folder.name}
          </p>
          <h1 className="mt-2 font-display text-4xl text-[var(--foreground)]">
            {folder.name}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            {folder.description}
          </p>
        </div>
        <Link
          href="/dossiers"
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-sm font-medium transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Tous les dossiers
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-14 text-center">
          <p className="font-display text-2xl text-[var(--foreground)]">
            Dossier vide
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
            Déplacez des documents depuis l’historique ou une analyse pour les
            classer ici.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link
              href="/historique"
              className="inline-flex h-9 items-center rounded-lg border border-[var(--border-strong)] px-4 text-sm font-medium hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              Voir l’historique
            </Link>
            <Link
              href="/"
              className="inline-flex h-9 items-center rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-foreground)] hover:bg-[var(--accent-hover)]"
            >
              Analyser un PDF
            </Link>
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="surface-panel animate-fade-up rounded-2xl px-5 py-4"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 space-y-2 text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium text-[var(--foreground)]">
                      {item.title}
                    </p>
                    <span
                      className={cn(
                        "rounded-md px-2 py-0.5 text-xs font-medium",
                        getRiskToneClass(item.riskLevel),
                      )}
                    >
                      {getRiskLevelLabel(item.riskLevel)} · {item.riskScore}
                    </span>
                  </div>
                  <p className="truncate text-sm text-[var(--muted)]">
                    {item.fileName} · {item.categoryLabel}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    Analysé le {formatDateTime(item.analyzedAt)}
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <FolderSelect
                    historyId={item.id}
                    value={item.folderId}
                    className="min-w-[180px]"
                    size="sm"
                    onMoved={() => {
                      void load();
                    }}
                  />
                  <Link
                    href={`/historique/${item.id}`}
                    className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-[var(--border-strong)] px-3 text-xs font-medium transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    Ouvrir
                    <ChevronRightIcon className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
