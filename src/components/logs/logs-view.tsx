"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Alert, Button, Skeleton } from "@/components/ui";
import { buildReportHref } from "@/lib/client/beta";
import { fetchAnalysisLogs } from "@/lib/client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PublicAnalysisLogEntry } from "@/types";

export function LogsView() {
  const [entries, setEntries] = useState<PublicAnalysisLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAnalysisLogs({
        limit: 150,
        errorsOnly,
      });
      setEntries(data.entries as PublicAnalysisLogEntry[]);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [errorsOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-tight text-[var(--foreground)]">
            Journal d&apos;analyses
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            Historique lisible de vos analyses : durée, catégorie, résumé ou
            erreur (messages nettoyés, sans données sensibles).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={errorsOnly ? "primary" : "secondary"}
            onClick={() => setErrorsOnly((v) => !v)}
          >
            {errorsOnly ? "Toutes les analyses" : "Erreurs seulement"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => void load()}>
            Rafraîchir
          </Button>
        </div>
      </div>

      <p className="text-sm text-[var(--muted)]">{total} entrée(s)</p>

      {error ? (
        <Alert tone="error" title="Erreur">
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : entries.length === 0 ? (
        <Alert tone="info" title="Aucune entrée">
          Lancez une analyse pour remplir le journal.
        </Alert>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => {
            const open = expandedId === entry.id;
            return (
              <li
                key={entry.id}
                className="surface-panel overflow-hidden rounded-2xl text-left"
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(open ? null : entry.id)}
                  className="flex w-full flex-col gap-2 px-5 py-4 text-left transition-colors hover:bg-[var(--surface-elevated)] sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--foreground)]">
                      {entry.fileName || "Document"}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {formatDateTime(entry.at)} · {entry.categoryLabel} ·{" "}
                      {Math.round(entry.durationMs / 1000)}s · {entry.model}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex rounded-lg px-2.5 py-1 text-xs font-medium",
                      entry.ok
                        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "bg-[var(--danger-soft)] text-[var(--danger)]",
                    )}
                  >
                    {entry.ok ? "OK" : "Erreur"}
                  </span>
                </button>

                {open ? (
                  <div className="space-y-3 border-t border-[var(--border)] px-5 py-4 text-sm">
                    {entry.summary ? (
                      <p className="text-[var(--foreground)]">{entry.summary}</p>
                    ) : null}
                    {entry.errorMessage ? (
                      <div className="space-y-2">
                        <p className="text-[var(--danger)]">{entry.errorMessage}</p>
                        <Link
                          href={buildReportHref({
                            kind: "analysis",
                            message: `Erreur d'analyse sur ${entry.fileName || "document"}`,
                            detail: entry.errorMessage,
                          })}
                          className="text-[var(--accent)] underline-offset-2 hover:underline"
                        >
                          Signaler cette erreur
                        </Link>
                      </div>
                    ) : null}
                    <ul className="space-y-1 text-xs text-[var(--muted)]">
                      {entry.steps.map((step, index) => (
                        <li key={`${entry.id}-${index}`}>
                          {step.task} · {Math.round(step.durationMs / 1000)}s
                          {step.ok ? "" : " · échec"}
                          {step.note ? ` — ${step.note}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
