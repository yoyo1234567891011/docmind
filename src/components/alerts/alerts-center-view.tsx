"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { NotificationPreferencesPanel } from "@/components/alerts/notification-preferences-panel";
import { Alert, Button, HistoryListSkeleton } from "@/components/ui";
import { ChevronRightIcon } from "@/components/ui/icons";
import {
  dismissAlerts,
  fetchAlerts,
  markAllAlertsAsRead,
} from "@/lib/client";
import { formatDate } from "@/lib/format";
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
  { id: "relation_redundant_payment", label: "Même montant récurrent ?" },
  { id: "relation_deadline_conflict", label: "Échéances liées" },
  { id: "relation_contradiction", label: "Contradictions" },
];

const ECHEANCE_KINDS: AlertKind[] = [
  "deadline_soon",
  "renewal",
  "termination",
  "important_payment",
  "relation_deadline_conflict",
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

function sortByDueDate(a: DocumentAlert, b: DocumentAlert): number {
  const da = a.dueDate || a.date || "";
  const db = b.dueDate || b.date || "";
  if (da && db) return da.localeCompare(db);
  if (da) return -1;
  if (db) return 1;
  return b.createdAt.localeCompare(a.createdAt);
}

export function AlertsCenterView() {
  const searchParams = useSearchParams();
  const focusEcheances = searchParams.get("focus") === "echeances";
  const [kind, setKind] = useState<AlertKind | "all">(
    focusEcheances ? "deadline_soon" : "all",
  );
  const [alerts, setAlerts] = useState<DocumentAlert[]>([]);
  const [summary, setSummary] = useState<AlertsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (focusEcheances) setKind("deadline_soon");
  }, [focusEcheances]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchAlerts({
        kind: focusEcheances ? "all" : kind,
      });
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
  }, [kind, focusEcheances]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleAlerts = useMemo(() => {
    if (!focusEcheances) return alerts;
    return alerts
      .filter((a) => ECHEANCE_KINDS.includes(a.kind))
      .slice()
      .sort(sortByDueDate);
  }, [alerts, focusEcheances]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="animate-fade-up text-left">
          <h1 className="font-display text-3xl tracking-tight text-[var(--foreground)] md:text-5xl">
            {focusEcheances ? "Mes échéances" : "Alertes"}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)] sm:text-base">
            {focusEcheances
              ? "Timeline par date : préavis, renouvellements, paiements et échéances liées — sans changer votre bibliothèque documents."
              : "Échéances, relations entre documents, paiements et risques — détectés automatiquement à partir de vos fiches et de la mémoire documentaire."}
          </p>
          {focusEcheances ? (
            <p className="mt-2 text-sm text-[var(--muted)]">
              <Link href="/alertes" className="text-[var(--accent)] hover:underline">
                Voir toutes les alertes
              </Link>
            </p>
          ) : (
            <p className="mt-2 text-sm text-[var(--muted)]">
              <Link
                href="/alertes?focus=echeances"
                className="text-[var(--accent)] hover:underline"
              >
                Ouvrir Mes échéances
              </Link>
            </p>
          )}
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

      {summary && !focusEcheances ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
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

      {!focusEcheances ? (
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
      ) : null}

      {error ? (
        <Alert tone="error" title="Erreur">
          {error}
        </Alert>
      ) : null}

      {isLoading ? (
        <HistoryListSkeleton />
      ) : visibleAlerts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-14 text-center">
          <p className="font-display text-2xl text-[var(--foreground)]">
            {focusEcheances ? "Aucune échéance" : "Aucune notification"}
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
            {focusEcheances
              ? "Rien à surveiller pour le moment — aucune obligation d’utiliser les alertes."
              : "Analysez des documents pour générer automatiquement des notifications (échéance, risque, action)."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visibleAlerts.map((item) => (
            <li
              key={item.id}
              className={cn(
                "surface-panel rounded-2xl px-5 py-4 text-left",
                !item.read &&
                  "ring-1 ring-[color-mix(in_oklab,var(--accent)_25%,transparent)]",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-md px-2 py-0.5 text-[11px] font-medium",
                        severityClass(item.severity),
                      )}
                    >
                      {ALERT_KIND_LABELS[item.kind]}
                    </span>
                    <span className="text-[11px] text-[var(--muted)]">
                      {ALERT_PRIORITY_LABELS[item.priority]}
                    </span>
                    {item.dueDate || item.date ? (
                      <span className="text-[11px] font-medium text-[var(--foreground)]">
                        {formatDate(item.dueDate || item.date)}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 font-medium text-[var(--foreground)]">
                    {item.title}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">{item.message}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {item.documentTitle || item.fileName}
                    {item.recommendedAction
                      ? ` · ${item.recommendedAction}`
                      : null}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Link
                    href={`/historique/${item.historyId}`}
                    className="inline-flex items-center gap-1 text-sm text-[var(--accent)] hover:underline"
                  >
                    Ouvrir
                    <ChevronRightIcon className="h-4 w-4" />
                  </Link>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void dismissAlerts([item.id]).then(() => load());
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
