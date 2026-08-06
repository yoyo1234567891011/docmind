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
import { Alert, AnalysisSkeleton, Button } from "@/components/ui";
import { siteConfig } from "@/config/site";
import { fetchAlerts, fetchHistory, fetchMe } from "@/lib/client";
import {
  readRecentSearches,
  type RecentSearch,
} from "@/lib/client/recent-searches";
import {
  computeDashboardStats,
  filterRelationAlerts,
  filterUpcomingDeadlineAlerts,
} from "@/lib/dashboard-stats";
import type { DocumentAlert, HistoryListItem } from "@/types";

export function DashboardView() {
  const [items, setItems] = useState<HistoryListItem[]>([]);
  const [deadlines, setDeadlines] = useState<DocumentAlert[]>([]);
  const [relationAlerts, setRelationAlerts] = useState<DocumentAlert[]>([]);
  const [searches, setSearches] = useState<RecentSearch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [history, alertsResult, me] = await Promise.all([
        fetchHistory({}),
        fetchAlerts({ includeDismissed: false }),
        fetchMe().catch(() => null),
      ]);
      setItems(history);
      setDeadlines(filterUpcomingDeadlineAlerts(alertsResult.alerts));
      setRelationAlerts(filterRelationAlerts(alertsResult.alerts));
      setSearches(readRecentSearches(me?.user?.id));
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

  const stats = useMemo(
    () =>
      computeDashboardStats(items, {
        upcomingDeadlinesCount: deadlines.length,
      }),
    [items, deadlines.length],
  );

  return (
    <div className="space-y-8">
      <header className="relative overflow-hidden rounded-[1.75rem] border border-[var(--border)] bg-[var(--surface)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,var(--accent-mist),transparent_55%),linear-gradient(135deg,var(--surface)_0%,var(--surface-elevated)_100%)]"
        />
        <div
          aria-hidden
          className="page-grid pointer-events-none absolute inset-0 opacity-50"
        />
        <div className="relative flex flex-col gap-6 px-6 py-8 sm:flex-row sm:items-end sm:justify-between sm:px-8 sm:py-10">
          <div className="animate-fade-up max-w-2xl text-left">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
              {siteConfig.name}
            </p>
            <h1 className="mt-3 font-display text-4xl tracking-tight text-[var(--foreground)] sm:text-5xl">
              Tableau de bord
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-[var(--muted)] sm:text-base">
              Documents récents, risques, échéances et activité — une vue claire
              pour piloter vos analyses.
            </p>
          </div>
          <div className="animate-fade-up-delay-1 flex flex-wrap gap-2">
            <Link
              href="/analyser"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)]"
            >
              Analyser un PDF
            </Link>
            <Link
              href="/recherche"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              Recherche
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-10"
              onClick={() => void load()}
            >
              Actualiser
            </Button>
          </div>
        </div>
      </header>

      {error ? (
        <Alert tone="error" title="Erreur de chargement">
          {error}
        </Alert>
      ) : null}

      <SubscriptionCard />

      <PremiumMemoryPanel />

      {isLoading ? (
        <AnalysisSkeleton />
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <h2 className="font-display text-2xl tracking-tight">
                Statistiques
              </h2>
              <p className="text-xs text-[var(--muted)]">
                {stats.totalAnalyses} analyse
                {stats.totalAnalyses > 1 ? "s" : ""} au total
              </p>
            </div>
            <DashboardStatCards cards={stats.cards} />
          </section>

          {items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-16 text-center">
              <p className="font-display text-3xl text-[var(--foreground)]">
                Votre espace est prêt
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
                Analysez un premier PDF pour alimenter le tableau de bord :
                risques, échéances et statistiques.
              </p>
              <Link
                href="/analyser"
                className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-[var(--accent)] px-5 text-sm font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)]"
              >
                Analyser un PDF
              </Link>
            </div>
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
                  <CounterpartiesPanel />
                </div>
              </div>

              <section className="space-y-3">
                <h2 className="font-display text-2xl tracking-tight">
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

              <LatestAnalysesTable items={stats.latestAnalyses} />
            </>
          )}
        </>
      )}
    </div>
  );
}
