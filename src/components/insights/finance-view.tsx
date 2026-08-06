"use client";

import { useCallback, useEffect, useState } from "react";

import { Alert, HistoryListSkeleton } from "@/components/ui";
import { fetchFinanceInsight } from "@/lib/client/insights";
import type { FinanceInsight } from "@/types/insights";

function money(n: number): string {
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €`;
}

export function FinanceView() {
  const [data, setData] = useState<FinanceInsight | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchFinanceInsight());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Impossible de charger les finances.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="animate-fade-up text-left">
        <h1 className="font-display text-4xl tracking-tight sm:text-5xl">
          Tableau de bord financier
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted)] sm:text-base">
          Combien vous payez par mois et par catégorie, d’après les montants
          extraits de vos documents indexés.
        </p>
      </div>

      {error ? (
        <Alert tone="error" title="Erreur">
          {error}
        </Alert>
      ) : null}

      {loading || !data ? (
        <HistoryListSkeleton />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-5">
              <p className="text-xs text-[var(--muted)]">Total mensuel</p>
              <p className="mt-1 font-display text-3xl">
                {money(data.monthlyTotalEur)}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-5">
              <p className="text-xs text-[var(--muted)]">Total annuel</p>
              <p className="mt-1 font-display text-3xl">
                {money(data.annualTotalEur)}
              </p>
            </div>
          </div>

          <section className="space-y-3">
            <h2 className="font-display text-2xl tracking-tight">
              Par catégorie
            </h2>
            {data.byCategory.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                Pas encore de montants catégorisés.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                {data.byCategory.map((c) => (
                  <li
                    key={c.category}
                    className="flex items-center justify-between gap-4 px-5 py-3"
                  >
                    <div>
                      <p className="font-medium">{c.label}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {c.count} contrepartie{c.count > 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{money(c.monthlyEur)}/mois</p>
                      <p className="text-xs text-[var(--muted)]">
                        {money(c.annualEur)}/an
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-2xl tracking-tight">
              Évolution dans le temps
            </h2>
            {data.series.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                Pas encore de série temporelle.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.series.map((p) => {
                  const max = Math.max(
                    ...data.series.map((x) => x.totalEur),
                    1,
                  );
                  const pct = Math.round((p.totalEur / max) * 100);
                  return (
                    <li key={p.month} className="text-left">
                      <div className="mb-1 flex justify-between text-xs text-[var(--muted)]">
                        <span>{p.month}</span>
                        <span>
                          {money(p.totalEur)} · {p.documentCount} doc
                          {p.documentCount > 1 ? "s" : ""}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[var(--background)]">
                        <div
                          className="h-full rounded-full bg-[var(--accent)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
