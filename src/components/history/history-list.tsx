"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { FolderSelect } from "@/components/folders/folder-select";
import { HistoryFilters } from "@/components/history/history-filters";
import { Alert, Button, HistoryListSkeleton } from "@/components/ui";
import { ChevronRightIcon, TrashIcon } from "@/components/ui/icons";
import { deleteHistoryItem, fetchHistory } from "@/lib/client";
import { formatDateTime, getRiskLevelLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HistoryListItem, HistoryQuery } from "@/types";

function riskTone(level: HistoryListItem["riskLevel"]) {
  switch (level) {
    case "critique":
    case "eleve":
      return "text-[var(--danger)] bg-[var(--danger-soft)]";
    case "modere":
      return "text-[var(--warning)] bg-[var(--warning-soft)]";
    default:
      return "text-[var(--accent)] bg-[var(--accent-soft)]";
  }
}

export function HistoryList() {
  const [query, setQuery] = useState<HistoryQuery>({
    search: "",
    category: "all",
    riskLevel: "all",
  });
  const [items, setItems] = useState<HistoryListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadHistory = useCallback(async (nextQuery: HistoryQuery) => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await fetchHistory(nextQuery);
      setItems(data);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger l'historique.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadHistory(query);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [query, loadHistory]);

  const handleDelete = async (id: string) => {
    const confirmed = window.confirm(
      "Supprimer cette analyse de l'historique ?",
    );
    if (!confirmed) return;

    setDeletingId(id);
    setError(null);

    try {
      await deleteHistoryItem(id);
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Suppression impossible.",
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <HistoryFilters query={query} onChange={setQuery} />

      {error ? (
        <Alert tone="error" title="Erreur">
          {error}
        </Alert>
      ) : null}

      {isLoading ? <HistoryListSkeleton /> : null}

      {!isLoading && items.length === 0 ? (
        <div className="animate-fade-up rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-14 text-center">
          <p className="font-display text-2xl text-[var(--foreground)]">
            Aucune analyse trouvée
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
            Lancez une analyse depuis la page d’accueil, ou élargissez vos
            filtres.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex h-9 items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)]"
          >
            Analyser un PDF
          </Link>
        </div>
      ) : null}

      {!isLoading && items.length > 0 ? (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="animate-fade-up surface-panel rounded-2xl px-5 py-4 text-left transition-colors duration-200 hover:border-[var(--border-strong)]"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium text-[var(--foreground)]">
                      {item.title}
                    </p>
                    <span
                      className={cn(
                        "rounded-md px-2 py-0.5 text-xs font-medium",
                        riskTone(item.riskLevel),
                      )}
                    >
                      {getRiskLevelLabel(item.riskLevel)} · {item.riskScore}/100
                    </span>
                  </div>
                  <p className="truncate text-sm text-[var(--muted)]">
                    {item.fileName} · {item.categoryLabel}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    Analysé le {formatDateTime(item.analyzedAt)}
                  </p>
                </div>

              <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-end">
                <FolderSelect
                  historyId={item.id}
                  value={item.folderId}
                  size="sm"
                  className="min-w-[160px]"
                  onMoved={(folderId) => {
                    setItems((current) =>
                      current.map((entry) =>
                        entry.id === item.id
                          ? { ...entry, folderId }
                          : entry,
                      ),
                    );
                  }}
                />
                <Link
                  href={`/historique/${item.id}`}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  Rouvrir
                  <ChevronRightIcon className="h-4 w-4" />
                </Link>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={deletingId === item.id}
                  onClick={() => {
                    void handleDelete(item.id);
                  }}
                >
                  <TrashIcon className="h-4 w-4" />
                  {deletingId === item.id ? "Suppression…" : "Supprimer"}
                </Button>
              </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
