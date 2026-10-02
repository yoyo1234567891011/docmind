"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DashboardStatCards } from "@/components/dashboard/dashboard-stat-cards";
import { DeadlineList } from "@/components/dashboard/deadline-list";
import { DistributionList } from "@/components/dashboard/distribution-list";
import { DocumentLinkList } from "@/components/dashboard/document-link-list";
import { LatestAnalysesTable } from "@/components/dashboard/latest-analyses-table";
import { RecentSearchesList } from "@/components/dashboard/recent-searches-list";
import { RelationAlertsList } from "@/components/dashboard/relation-alerts-list";
import { CounterpartiesPanel } from "@/components/dashboard/counterparties-panel";
import { PremiumMemoryPanel } from "@/components/insights/premium-memory-panel";
import { SubscriptionCard } from "@/components/dashboard/subscription-card";
import { HistoryBulkActionBar } from "@/components/history/history-bulk-action-bar";
import { useHistoryBulkSelection } from "@/components/history/use-history-bulk-selection";
import { Alert, AnalysisSkeleton, Button } from "@/components/ui";
import { UploadIcon } from "@/components/ui/icons";
import { siteConfig } from "@/config/site";
import {
  deleteHistoryItemsBulk,
  fetchAlerts,
  fetchHistory,
  fetchMe,
} from "@/lib/client";
import {
  consumeDashboardStale,
  isDashboardStale,
  markDashboardStale,
  onDashboardRefresh,
} from "@/lib/client/dashboard-sync";
import {
  readRecentSearches,
  type RecentSearch,
} from "@/lib/client/recent-searches";
import { collapseHistoryDuplicates } from "@/lib/dashboard-display";
import {
  computeDashboardStats,
  countUpcomingDeadlineAlerts,
  listRelationAlertsForDisplay,
  listUpcomingDeadlineAlertsForDisplay,
} from "@/lib/dashboard-stats";
import type { DocumentAlert, HistoryListItem } from "@/types";

export function DashboardView() {
  const [items, setItems] = useState<HistoryListItem[]>([]);
  const [deadlines, setDeadlines] = useState<DocumentAlert[]>([]);
  const [relationAlerts, setRelationAlerts] = useState<DocumentAlert[]>([]);
  const [deadlineTotal, setDeadlineTotal] = useState(0);
  const [searches, setSearches] = useState<RecentSearch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  /** Incrémente pour forcer le refetch des panneaux enfants. */
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Chargement partiel : une API en erreur ne doit pas effacer les autres données valides.
      const [historyResult, alertsResult, meResult] = await Promise.allSettled([
        fetchHistory({}),
        fetchAlerts({ includeDismissed: false }),
        fetchMe(),
      ]);

      const partialErrors: string[] = [];

      if (historyResult.status === "fulfilled") {
        setItems(historyResult.value);
      } else {
        const msg =
          historyResult.reason instanceof Error
            ? historyResult.reason.message
            : "Historique indisponible.";
        partialErrors.push(msg);
      }

      if (alertsResult.status === "fulfilled") {
        const alerts = alertsResult.value.alerts;
        setDeadlineTotal(countUpcomingDeadlineAlerts(alerts));
        setDeadlines(listUpcomingDeadlineAlertsForDisplay(alerts));
        setRelationAlerts(listRelationAlertsForDisplay(alerts));
      } else {
        const msg =
          alertsResult.reason instanceof Error
            ? alertsResult.reason.message
            : "Alertes indisponibles.";
        partialErrors.push(msg);
      }

      if (meResult.status === "fulfilled") {
        setSearches(readRecentSearches(meResult.value?.user?.id));
      }
      // Échec /api/me : ne pas basculer sur le bucket « anonymous » (fuite de contexte).

      if (partialErrors.length > 0) {
        // Si l’historique a échoué et qu’on n’a rien d’autre : erreur globale.
        if (historyResult.status === "rejected") {
          setError(partialErrors.join(" · "));
        } else {
          setError(
            `Données partielles : ${partialErrors.join(" · ")}`,
          );
        }
      } else {
        setError(null);
      }

      setRefreshKey((k) => k + 1);
      consumeDashboardStale();
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger le tableau de bord.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Refetch quand une mutation (delete / analyse) a marqué le dashboard stale.
  useEffect(() => {
    return onDashboardRefresh(() => {
      void load();
    });
  }, [load]);

  // Retour sur l’onglet / la page après suppression ailleurs.
  useEffect(() => {
    const maybeReload = () => {
      if (isDashboardStale()) {
        void load();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") maybeReload();
    };
    window.addEventListener("focus", maybeReload);
    window.addEventListener("pageshow", maybeReload);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", maybeReload);
      window.removeEventListener("pageshow", maybeReload);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const handleManualRefresh = useCallback(() => {
    markDashboardStale("manual");
    void load();
  }, [load]);

  const stats = useMemo(
    () =>
      computeDashboardStats(items, {
        upcomingDeadlinesCount: deadlineTotal,
      }),
    [items, deadlineTotal],
  );

  const latestVisibleIds = useMemo(
    () => collapseHistoryDuplicates(stats.latestAnalyses).map((i) => i.id),
    [stats.latestAnalyses],
  );

  const allPanelVisibleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const list of [
      stats.recentDocuments,
      stats.atRiskDocuments,
      stats.latestAnalyses,
    ]) {
      for (const item of collapseHistoryDuplicates(list)) {
        ids.add(item.id);
      }
    }
    return [...ids];
  }, [stats.recentDocuments, stats.atRiskDocuments, stats.latestAnalyses]);

  const bulk = useHistoryBulkSelection(allPanelVisibleIds);

  const tableAllSelected =
    latestVisibleIds.length > 0 &&
    latestVisibleIds.every((id) => bulk.selectedIds.has(id));

  const toggleSelectAllTable = useCallback(() => {
    bulk.setMany(latestVisibleIds, !tableAllSelected);
  }, [bulk, latestVisibleIds, tableAllSelected]);

  const handleBulkDelete = useCallback(async () => {
    const n = bulk.selectedCount;
    if (n < 1) return;
    if (
      !window.confirm(
        `Supprimer ${n} document${n > 1 ? "s" : ""} ? Irréversible.`,
      )
    ) {
      return;
    }
    setBulkBusy(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const selected = bulk.selectedList;
      const result = await deleteHistoryItemsBulk(selected);
      const failedSet = new Set(result.failed.map((f) => f.id));
      if (result.deleted > 0) {
        setItems((prev) =>
          prev.filter(
            (row) => !selected.includes(row.id) || failedSet.has(row.id),
          ),
        );
        setSuccessMessage(
          `${result.deleted} document${result.deleted > 1 ? "s" : ""} supprimé${result.deleted > 1 ? "s" : ""}`,
        );
        bulk.clearSelection();
        setRefreshKey((k) => k + 1);
      }
      if (result.failed.length > 0 && result.deleted === 0) {
        setError(
          result.failed
            .map((f) => `${f.id.slice(0, 8)}… : ${f.reason}`)
            .join(" · "),
        );
      } else if (result.failed.length > 0) {
        setError(
          `${result.failed.length} échec(s) : ${result.failed
            .map((f) => f.reason)
            .join(" · ")}`,
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Suppression groupée impossible.",
      );
    } finally {
      setBulkBusy(false);
    }
  }, [bulk]);

  return (
    <div className="space-y-8 pb-20 md:pb-8">
      <header className="relative isolate overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--hairline)] bg-[var(--surface)] shadow-[var(--highlight),var(--shadow-md)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_80%_at_0%_0%,color-mix(in_oklab,var(--accent)_12%,transparent),transparent_60%),radial-gradient(ellipse_40%_60%_at_100%_100%,color-mix(in_oklab,var(--accent)_6%,transparent),transparent_70%)]"
        />
        <div
          aria-hidden
          className="page-grid pointer-events-none absolute inset-0 -z-10 opacity-50"
        />
        <div className="relative flex flex-col gap-6 px-6 py-8 md:flex-row md:items-end md:justify-between md:px-9 md:py-10">
          <div className="animate-fade-up max-w-2xl text-left">
            <p className="ui-kicker flex items-center gap-2 text-[var(--accent)]">
              <span aria-hidden className="ui-live-dot h-1.5 w-1.5" />
              {siteConfig.name}
            </p>
            <h1 className="mt-4 font-display text-[2.5rem] leading-[1.05] tracking-[-0.025em] text-[var(--foreground)] sm:text-[3.25rem]">
              Tableau de bord
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--muted)] sm:text-[15px]">
              Documents récents, risques, échéances et activité — une vue claire
              pour piloter vos analyses.
            </p>
          </div>
          <div className="animate-fade-up-delay-1 flex flex-wrap items-center gap-2">
            <Link
              href="/analyser"
              className="inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent)] px-4 text-sm font-medium tracking-[-0.01em] text-[var(--accent-foreground)] shadow-[inset_0_1px_0_color-mix(in_oklab,white_18%,transparent),var(--shadow-accent)] transition-[background-color,transform] duration-150 hover:bg-[var(--accent-hover)] active:scale-[0.98]"
            >
              Analyser un PDF
            </Link>
            <Link
              href="/recherche"
              className="inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-sm font-medium tracking-[-0.01em] text-[var(--foreground)] shadow-[var(--highlight),var(--shadow-xs)] transition-[border-color,color,box-shadow,transform] duration-150 hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border-strong))] hover:text-[var(--accent)] hover:shadow-[var(--highlight),var(--shadow-sm)] active:scale-[0.98]"
            >
              Recherche
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-10"
              onClick={handleManualRefresh}
            >
              Actualiser
            </Button>
          </div>
        </div>
      </header>

      {error ? (
        <Alert tone="error" title="Erreur">
          {error}
        </Alert>
      ) : null}
      {successMessage ? (
        <Alert tone="success" title="OK">
          {successMessage}
        </Alert>
      ) : null}

      <HistoryBulkActionBar
        selectedCount={bulk.selectedCount}
        busy={bulkBusy}
        onDelete={() => void handleBulkDelete()}
        onCancel={bulk.clearSelection}
      />

      <SubscriptionCard refreshKey={refreshKey} />

      <PremiumMemoryPanel refreshKey={refreshKey} />

      {isLoading ? (
        <AnalysisSkeleton />
      ) : (
        <>
          <section className="space-y-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between md:gap-3">
              <h2 className="font-display text-[1.75rem] tracking-tight">
                Statistiques
              </h2>
              <p className="font-mono text-[11px] tabular-nums text-[var(--muted)]">
                {stats.totalAnalyses} analyse
                {stats.totalAnalyses > 1 ? "s" : ""} au total
              </p>
            </div>
            <DashboardStatCards cards={stats.cards} />
          </section>

          {items.length === 0 ? (
            <>
              <div className="relative isolate overflow-hidden rounded-[var(--radius-2xl)] border border-dashed border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--surface)_80%,transparent)] px-6 py-16 text-center">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_50%_60%_at_50%_0%,color-mix(in_oklab,var(--accent)_10%,transparent),transparent_70%)]"
                />
                <span
                  aria-hidden
                  className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--accent)_25%,var(--border))] bg-[var(--surface)] text-[var(--accent)] shadow-[var(--highlight),var(--shadow-sm)]"
                >
                  <UploadIcon className="h-5 w-5" />
                </span>
                <p className="font-display text-3xl text-[var(--foreground)]">
                  Votre espace est prêt
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
                  Analysez un premier PDF pour alimenter le tableau de bord :
                  risques, échéances et statistiques.
                </p>
                <Link
                  href="/analyser"
                  className="mt-7 inline-flex h-10 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent)] px-5 text-sm font-medium text-[var(--accent-foreground)] shadow-[inset_0_1px_0_color-mix(in_oklab,white_18%,transparent),var(--shadow-accent)] transition-[background-color,transform] duration-150 hover:bg-[var(--accent-hover)] active:scale-[0.98]"
                >
                  Analyser un PDF
                </Link>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <CounterpartiesPanel refreshKey={refreshKey} />
                <DeadlineList alerts={deadlines} />
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-12">
                <div className="lg:col-span-7">
                  <DocumentLinkList
                    title="Documents récents"
                    subtitle="Derniers fichiers analysés"
                    items={stats.recentDocuments}
                    emptyLabel="Aucun document récent."
                    viewAllHref="/historique"
                    checkedIds={bulk.selectedIds}
                    bulkBusy={bulkBusy}
                    onToggleCheck={bulk.toggle}
                  />
                </div>
                <div className="lg:col-span-5">
                  <DocumentLinkList
                    title="Documents à risque"
                    subtitle="Niveaux élevé et critique"
                    items={stats.atRiskDocuments}
                    emptyLabel="Aucun document à risque élevé."
                    viewAllHref="/historique?riskLevel=eleve"
                    showActions
                    checkedIds={bulk.selectedIds}
                    bulkBusy={bulkBusy}
                    onToggleCheck={bulk.toggle}
                  />
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-12">
                <div className="space-y-4 lg:col-span-5">
                  <DeadlineList alerts={deadlines} />
                  <RelationAlertsList alerts={relationAlerts} />
                </div>
                <div className="space-y-4 lg:col-span-7">
                  <RecentSearchesList searches={searches} />
                  <CounterpartiesPanel refreshKey={refreshKey} />
                </div>
              </div>

              <section className="space-y-4">
                <h2 className="font-display text-[1.75rem] tracking-tight">
                  Répartitions
                </h2>
                <div className="grid gap-4 lg:grid-cols-2">
                  <DistributionList
                    title="Par niveau de risque"
                    subtitle="Répartition de votre portefeuille"
                    items={stats.riskDistribution}
                    emptyLabel="Aucune donnée de risque."
                    toneById
                  />
                  <DistributionList
                    title="Par catégorie"
                    subtitle="Types de documents analysés"
                    items={stats.categoryDistribution}
                    emptyLabel="Aucune catégorie disponible."
                  />
                </div>
              </section>

              <LatestAnalysesTable
                items={stats.latestAnalyses}
                checkedIds={bulk.selectedIds}
                allVisibleSelected={tableAllSelected}
                bulkBusy={bulkBusy}
                onToggleCheck={bulk.toggle}
                onToggleSelectAll={toggleSelectAllTable}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
