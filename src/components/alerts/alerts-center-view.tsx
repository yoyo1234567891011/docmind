"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { NotificationPreferencesPanel } from "@/components/alerts/notification-preferences-panel";
import { Alert, Button, HistoryListSkeleton } from "@/components/ui";
import { ChevronRightIcon } from "@/components/ui/icons";
import {
  dismissAlerts,
  fetchAlerts,
  markAllAlertsAsRead,
} from "@/lib/client";
import { cn } from "@/lib/utils";
import {
  ALERT_KIND_LABELS,
  ALERT_PRIORITY_LABELS,
  type AlertKind,
  type AlertsSummary,
  type DocumentAlert,
} from "@/types";

const FILTERS: Array<{ id: AlertKind | "all"; label: string }> = [
  { id: "all", label: "Toutes" },
  { id: "analysis_ready", label: "Analyses prêtes" },
  { id: "deadline_soon", label: "Échéances" },
  { id: "high_risk", label: "Risques" },
  { id: "action_required", label: "Actions" },
  { id: "renewal", label: "Renouvellements" },
  { id: "termination", label: "Résiliations" },
  { id: "important_payment", label: "Paiements" },
  { id: "relation_duplicate", label: "Doublons" },
  { id: "relation_supersede", label: "Remplacements" },
  { id: "relation_overlap_risk", label: "Risques / garanties" },
  { id: "relation_redundant_payment", label: "Paiements redondants" },
  { id: "relation_deadline_conflict", label: "Échéances liées" },
  { id: "relation_contradiction", label: "Contradictions" },
];

function severityClass(severity: DocumentAlert["severity"]) {
  switch (severity) {
    case "critical":
      return "text-[var(--danger)] bg-[var(--danger-soft)]";
    case "warning":
      return "text-[var(--warning)] bg-[var(--warning-soft)]";
    default:
      return "text-[var(--accent)] bg-[var(--accent-soft)]";
  }
}

export function AlertsCenterView() {
  const [kind, setKind] = useState<AlertKind | "all">("all");
  const [alerts, setAlerts] = useState<DocumentAlert[]>([]);
  const [summary, setSummary] = useState<AlertsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchAlerts({ kind });
      setAlerts(data.alerts);
      setSummary(data.summary);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger les alertes.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="animate-fade-up text-left">
          <h1 className="font-display text-4xl tracking-tight text-[var(--foreground)] sm:text-5xl">
            Alertes
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)] sm:text-base">
            Échéances, relations entre documents, paiements et risques —
            détectés automatiquement à partir de vos fiches et de la mémoire
            documentaire.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            void markAllAlertsAsRead().then(() => load());
          }}
        >
          Tout marquer comme lu
        </Button>
      </div>

      {summary ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <article className="surface-panel rounded-2xl px-5 py-4">
            <p className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
              Actives
            </p>
            <p className="mt-2 font-display text-3xl">{summary.total}</p>
          </article>
          <article className="surface-panel rounded-2xl px-5 py-4">
            <p className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
              Non lues
            </p>
            <p className="mt-2 font-display text-3xl">{summary.unread}</p>
          </article>
          <article className="surface-panel rounded-2xl px-5 py-4">
            <p className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
              Échéances
            </p>
            <p className="mt-2 font-display text-3xl">
              {summary.byKind.deadline_soon}
            </p>
          </article>
          <article className="surface-panel rounded-2xl px-5 py-4">
            <p className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
              Risques
            </p>
            <p className="mt-2 font-display text-3xl text-[var(--danger)]">
              {summary.byKind.high_risk}
            </p>
          </article>
          <article className="surface-panel rounded-2xl px-5 py-4">
            <p className="text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
              Actions
            </p>
            <p className="mt-2 font-display text-3xl">
              {summary.byKind.action_required}
            </p>
          </article>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            onClick={() => setKind(filter.id)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition-colors",
              kind === filter.id
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--border-strong)] hover:text-[var(--foreground)]",
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {error ? (
        <Alert tone="error" title="Erreur">
          {error}
        </Alert>
      ) : null}

      {isLoading ? (
        <HistoryListSkeleton />
      ) : alerts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-14 text-center">
          <p className="font-display text-2xl text-[var(--foreground)]">
            Aucune notification
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
            Analysez des documents pour générer automatiquement des
            notifications (échéance, risque, action).
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {alerts.map((alert) => (
            <li
              key={alert.id}
              className="surface-panel animate-fade-up rounded-2xl px-5 py-4 text-left"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-[var(--foreground)]">
                      {alert.title}
                    </p>
                    <span
                      className={cn(
                        "rounded-md px-2 py-0.5 text-xs font-medium",
                        severityClass(alert.severity),
                      )}
                    >
                      {ALERT_PRIORITY_LABELS[alert.priority]}
                    </span>
                    <span className="rounded-md border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">
                      {ALERT_KIND_LABELS[alert.kind]}
                    </span>
                    {!alert.read ? (
                      <span className="rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-xs text-[var(--accent)]">
                        Nouveau
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-[var(--muted)]">{alert.message}</p>
                  <p className="text-xs text-[var(--muted)]">
                    Document : {alert.documentTitle} · {alert.fileName}
                    {" · "}
                    Date : {alert.date}
                    {alert.amount != null
                      ? ` · ${alert.amount.toLocaleString("fr-FR")} €`
                      : ""}
                  </p>
                  {alert.recommendedAction ? (
                    <p className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-xs text-[var(--foreground)]">
                      Action recommandée : {alert.recommendedAction}
                    </p>
                  ) : null}
                  {alert.evidence.length > 0 ? (
                    <ul className="space-y-1">
                      {alert.evidence.map((item) => (
                        <li
                          key={item}
                          className="rounded-lg bg-[var(--background)] px-3 py-2 text-xs text-[var(--foreground)]"
                        >
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <Link
                    href={`/historique/${alert.historyId}`}
                    className="inline-flex h-9 items-center gap-1 rounded-lg border border-[var(--border-strong)] px-4 text-sm font-medium transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  >
                    Ouvrir
                    <ChevronRightIcon className="h-4 w-4" />
                  </Link>
                  {alert.secondaryHistoryId ? (
                    <Link
                      href={`/historique/${alert.secondaryHistoryId}`}
                      className="inline-flex h-9 items-center gap-1 rounded-lg border border-[var(--border)] px-4 text-sm font-medium text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    >
                      Document lié
                    </Link>
                  ) : null}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      void dismissAlerts([alert.id]).then(() => load());
                    }}
                  >
                    Ignorer
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <NotificationPreferencesPanel />
    </div>
  );
}
