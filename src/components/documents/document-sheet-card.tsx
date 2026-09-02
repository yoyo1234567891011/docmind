import type { ReactNode } from "react";

import { resolveDisplaySummary } from "@/ai/post-processing/prod-quality";
import { cn } from "@/lib/utils";
import { parseAmountDisplay } from "@/services/extraction/amounts";
import type { DocumentSheet } from "@/types";

interface DocumentSheetCardProps {
  sheet: DocumentSheet;
  className?: string;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
        {label}
      </p>
      <div className="text-sm text-[var(--foreground)]">{children}</div>
    </div>
  );
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) {
    return <p className="text-[var(--muted)]">{empty}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2 leading-relaxed">
          <span
            aria-hidden
            className="mt-2 h-1.5 w-1.5 shrink-0 rounded-sm bg-[var(--accent)]"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function AmountList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-[var(--muted)]">Aucun montant.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item) => {
        const { value, label } = parseAmountDisplay(item);
        return (
          <li key={item} className="flex gap-2 leading-relaxed">
            <span
              aria-hidden
              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-sm bg-[var(--accent)]"
            />
            <span>
              <span className="font-medium tabular-nums">{value}</span>
              {label ? (
                <span className="text-[var(--muted)]"> — {label}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function DocumentSheetCard({
  sheet,
  className,
}: DocumentSheetCardProps) {
  return (
    <section
      className={cn(
        "surface-panel animate-fade-up rounded-2xl text-left",
        className,
      )}
      aria-label="Fiche document"
    >
      <header className="border-b border-[var(--border)] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--muted)]">
              Mémoire documentaire
            </p>
            <h2 className="mt-1 font-display text-2xl tracking-tight text-[var(--foreground)]">
              {sheet.name}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {sheet.type}
              {sheet.categoryLabel ? ` · ${sheet.categoryLabel}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
              Confiance
            </p>
            <p className="font-display text-2xl text-[var(--foreground)]">
              {Math.round((sheet.confidence ?? 0) * 100)}
              <span className="text-sm text-[var(--muted)]"> %</span>
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-5 px-5 py-5 md:grid-cols-2">
        <Field label="Type">
          <p className="font-medium">{sheet.type || "—"}</p>
        </Field>
        <Field label="Niveau de risque">
          <p className="font-medium">
            {sheet.riskLevel} · {sheet.riskScore}/100
          </p>
        </Field>

        <div className="sm:col-span-2">
          <Field label="Résumé">
            <p className="leading-relaxed">
              {resolveDisplaySummary(
                {
                  document_type: sheet.type,
                  title: sheet.name,
                  summary: sheet.summary,
                  date: sheet.dates[0] ?? "",
                  dates: sheet.dates,
                  people: sheet.people,
                  organizations: sheet.organizations,
                  amounts: sheet.amounts,
                  deadlines: sheet.deadlines,
                  important_points: [],
                  risks: sheet.risks,
                  actions: sheet.actions,
                  risk_score: sheet.riskScore,
                  risk_level: sheet.riskLevel,
                  risk_explanation: "",
                  risk_criteria: [],
                },
                {
                  category: sheet.category,
                  label: sheet.categoryLabel,
                  confidence: sheet.confidence,
                },
              )}
            </p>
          </Field>
        </div>

        <Field label="Personnes">
          <List items={sheet.people} empty="Aucune personne." />
        </Field>
        <Field label="Organisations">
          <List items={sheet.organizations} empty="Aucune organisation." />
        </Field>
        <Field label="Montants">
          <AmountList items={sheet.amounts} />
        </Field>
        <Field label="Dates">
          <List items={sheet.dates} empty="Aucune date." />
        </Field>
        <Field label="Échéances">
          <List items={sheet.deadlines} empty="Aucune échéance." />
        </Field>
        <Field label="Risques">
          <List items={sheet.risks} empty="Aucun risque listé." />
        </Field>
        <Field label="Actions">
          <List items={sheet.actions} empty="Aucune action." />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Mots-clés">
            {sheet.keywords?.length ? (
              <p className="leading-relaxed text-[var(--muted)]">
                {sheet.keywords.slice(0, 24).join(" · ")}
              </p>
            ) : (
              <p className="text-[var(--muted)]">Aucun mot-clé.</p>
            )}
          </Field>
        </div>
      </div>
    </section>
  );
}
