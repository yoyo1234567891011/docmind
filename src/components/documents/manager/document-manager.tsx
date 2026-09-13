"use client";

import Link from "next/link";
import { useMemo } from "react";

import { Alert } from "@/components/ui";
import { collapseHistoryDuplicates } from "@/lib/dashboard-display";

import { managerBreadcrumbLabel } from "./build-query";
import { DocumentList } from "./document-list";
import { DocumentPreviewPane } from "./document-preview-pane";
import { ManagerSidebar } from "./manager-sidebar";
import { ManagerToolbar } from "./manager-toolbar";
import { useDocumentManager } from "./use-document-manager";

/**
 * Gestionnaire de documents — liste d’analyses, dossiers, aperçu.
 */
export function DocumentManager() {
  const mgr = useDocumentManager();

  const breadcrumb = managerBreadcrumbLabel(
    mgr.sidebar,
    mgr.meta.folders,
    mgr.meta.tags,
  );

  /** Regroupement visuel (×N) — les analyses restent en base. */
  const displayItems = useMemo(
    () => collapseHistoryDuplicates(mgr.items),
    [mgr.items],
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="text-left">
          <h1 className="font-display text-3xl tracking-tight text-[var(--foreground)] sm:text-4xl">
            Documents
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
            Bibliothèque de vos analyses PDF — dossiers, filtres et accès rapide
            aux résultats.
          </p>
          <p className="mt-1 max-w-2xl text-xs text-[var(--muted)]">
            Chaque ligne est une analyse. Ré-analyser le même fichier crée une
            nouvelle entrée.
          </p>
        </div>
        <Link
          href="/analyser"
          className="inline-flex h-9 items-center rounded-md bg-[var(--accent)] px-3.5 text-sm font-medium text-[var(--accent-foreground)] hover:bg-[var(--accent-hover)]"
        >
          Analyser un PDF
        </Link>
      </header>

      {mgr.error ? (
        <Alert tone="error" title="Erreur">
          {mgr.error}
        </Alert>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_1px_0_rgba(0,0,0,0.03)]">
        <div className="grid min-h-[50vh] md:min-h-[70vh] lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_340px]">
          <ManagerSidebar
            filter={mgr.sidebar}
            folders={mgr.meta.folders}
            unfiledCount={mgr.meta.unfiledCount}
            tags={mgr.meta.tags}
            onFilterChange={mgr.setSidebar}
            onCreateFolder={mgr.createNewFolder}
            onCreateTag={mgr.createNewTag}
            onError={mgr.setError}
          />

          <section className="flex min-w-0 flex-col border-[var(--border)] lg:border-l-0">
            <ManagerToolbar
              filters={mgr.filters}
              viewMode={mgr.viewMode}
              breadcrumb={breadcrumb}
              total={displayItems.length}
              onFiltersChange={mgr.setFilters}
              onViewModeChange={mgr.setViewMode}
            />
            <div className="min-h-0 flex-1 overflow-auto">
              <DocumentList
                items={displayItems}
                isLoading={mgr.isLoading}
                viewMode={mgr.viewMode}
                selectedId={mgr.selectedId}
                busyId={mgr.busyId}
                tags={mgr.meta.tags}
                folders={mgr.meta.folders}
                tagMap={mgr.tagMap}
                onSelect={mgr.setSelectedId}
                onToggleFavorite={mgr.toggleFavorite}
                onRename={mgr.rename}
                onMove={mgr.moveToFolder}
                onToggleTag={mgr.toggleTag}
                onDelete={mgr.remove}
              />
            </div>
          </section>

          <div className="hidden xl:block">
            <DocumentPreviewPane
              selected={mgr.selected}
              tags={mgr.meta.tags}
              onToggleTag={mgr.toggleTag}
            />
          </div>
        </div>
      </div>

      {/* Aperçu sous la liste sur écrans < xl */}
      <div className="xl:hidden">
        <DocumentPreviewPane
          selected={mgr.selected}
          tags={mgr.meta.tags}
          onToggleTag={mgr.toggleTag}
        />
      </div>
    </div>
  );
}
