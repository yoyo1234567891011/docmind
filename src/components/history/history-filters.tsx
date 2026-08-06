"use client";

import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS } from "@/types";
import type { HistoryQuery, RiskAssessment } from "@/types";

interface HistoryFiltersProps {
  query: HistoryQuery;
  onChange: (query: HistoryQuery) => void;
}

const RISK_LEVELS: Array<RiskAssessment["risk_level"] | "all"> = [
  "all",
  "faible",
  "modere",
  "eleve",
  "critique",
];

const riskLabels: Record<RiskAssessment["risk_level"] | "all", string> = {
  all: "Tous les risques",
  faible: "Faible",
  modere: "Modéré",
  eleve: "Élevé",
  critique: "Critique",
};

const fieldClassName =
  "w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--accent)]";

export function HistoryFilters({ query, onChange }: HistoryFiltersProps) {
  return (
    <div className="surface-panel animate-fade-up grid gap-3 rounded-2xl p-4 md:grid-cols-[1.4fr_1fr_1fr]">
      <label className="block text-left">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
          Recherche
        </span>
        <input
          type="search"
          value={query.search ?? ""}
          placeholder="Fichier, titre, personne, organisation…"
          onChange={(event) =>
            onChange({ ...query, search: event.target.value })
          }
          className={fieldClassName}
        />
      </label>

      <label className="block text-left">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
          Type
        </span>
        <select
          value={query.category ?? "all"}
          onChange={(event) =>
            onChange({
              ...query,
              category: event.target.value as HistoryQuery["category"],
            })
          }
          className={fieldClassName}
        >
          <option value="all">Tous les types</option>
          {DOCUMENT_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {DOCUMENT_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-left">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
          Risque
        </span>
        <select
          value={query.riskLevel ?? "all"}
          onChange={(event) =>
            onChange({
              ...query,
              riskLevel: event.target.value as HistoryQuery["riskLevel"],
            })
          }
          className={fieldClassName}
        >
          {RISK_LEVELS.map((level) => (
            <option key={level} value={level}>
              {riskLabels[level]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
