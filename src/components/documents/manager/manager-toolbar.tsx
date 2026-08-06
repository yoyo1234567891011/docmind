"use client";

import { SearchIcon } from "@/components/ui/icons";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  type DocumentCategory,
  type DocumentSortDirection,
  type DocumentSortField,
  type RiskAssessment,
} from "@/types";

import type { ManagerFilters, ManagerViewMode } from "./types";

interface ManagerToolbarProps {
  filters: ManagerFilters;
  viewMode: ManagerViewMode;
  breadcrumb: string;
  total: number;
  onFiltersChange: (next: ManagerFilters) => void;
  onViewModeChange: (mode: ManagerViewMode) => void;
}

const RISK_OPTIONS: Array<RiskAssessment["risk_level"] | "all"> = [
  "all",
  "faible",
  "modere",
  "eleve",
  "critique",
];

export function ManagerToolbar({
  filters,
  viewMode,
  breadcrumb,
  total,
  onFiltersChange,
  onViewModeChange,
}: ManagerToolbarProps) {
  const patch = (partial: Partial<ManagerFilters>) =>
    onFiltersChange({ ...filters, ...partial });

  return (
    <div className="space-y-3 border-b border-[var(--border)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-left">
          <p className="truncate text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
            Documents / {breadcrumb}
          </p>
          <p className="mt-0.5 font-display text-xl text-[var(--foreground)]">
            {breadcrumb}
            <span className="ml-2 text-sm font-sans text-[var(--muted)]">
              {total}
            </span>
          </p>
        </div>
        <div className="flex rounded-md border border-[var(--border)] p-0.5">
          <button
            type="button"
            onClick={() => onViewModeChange("list")}
            className={`rounded px-2.5 py-1 text-xs ${
              viewMode === "list"
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "text-[var(--muted)]"
            }`}
          >
            Liste
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange("board")}
            className={`rounded px-2.5 py-1 text-xs ${
              viewMode === "board"
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "text-[var(--muted)]"
            }`}
          >
            Grille
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
          <input
            value={filters.search}
            onChange={(event) => patch({ search: event.target.value })}
            placeholder="Rechercher par nom, type, contenu…"
            className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-[var(--accent)]"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={filters.category}
            onChange={(event) =>
              patch({
                category: event.target.value as DocumentCategory | "all",
              })
            }
            className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs"
            title="Filtrer par catégorie"
          >
            <option value="all">Toutes catégories</option>
            {DOCUMENT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {DOCUMENT_CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>

          <select
            value={filters.riskLevel}
            onChange={(event) =>
              patch({
                riskLevel: event.target
                  .value as RiskAssessment["risk_level"] | "all",
              })
            }
            className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs"
            title="Filtrer par risque"
          >
            {RISK_OPTIONS.map((level) => (
              <option key={level} value={level}>
                {level === "all"
                  ? "Tous risques"
                  : level === "modere"
                    ? "Modéré"
                    : level === "eleve"
                      ? "Élevé"
                      : level.charAt(0).toUpperCase() + level.slice(1)}
              </option>
            ))}
          </select>

          <select
            value={filters.sortBy}
            onChange={(event) =>
              patch({ sortBy: event.target.value as DocumentSortField })
            }
            className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs"
            title="Trier par"
          >
            <option value="analyzedAt">Date</option>
            <option value="title">Nom</option>
            <option value="riskScore">Risque</option>
            <option value="fileName">Fichier</option>
          </select>

          <select
            value={filters.sortDir}
            onChange={(event) =>
              patch({ sortDir: event.target.value as DocumentSortDirection })
            }
            className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs"
            title="Ordre"
          >
            <option value="desc">↓ Décroissant</option>
            <option value="asc">↑ Croissant</option>
          </select>
        </div>
      </div>
    </div>
  );
}
