"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Alert, HistoryListSkeleton } from "@/components/ui";
import { fetchSubscriptions } from "@/lib/client/insights";
import { formatDate } from "@/lib/format";
import type { SubscriptionInsight } from "@/types/insights";

function money(n: number | null): string {
  if (n == null) return "—";
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €`;
}

export function SubscriptionsView() {
  const [items, setItems] = useState<SubscriptionInsight[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchSubscriptions());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Impossible de charger les abonnements.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const monthly = items.reduce((s, i) => s + (i.monthlyEur ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="animate-fade-up text-left">
        <h1 className="font-display text-4xl tracking-tight sm:text-5xl">
          Mes abonnements
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted)] sm:text-base">
          Reconstruits depuis votre mémoire documentaire (Orange, EDF, Netflix,
          assurances…) — montants, échéances et résiliation.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
          <p className="text-xs text-[var(--muted)]">Par mois</p>
          <p className="mt-1 font-display text-2xl">{money(monthly)}</p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
          <p className="text-xs text-[var(--muted)]">Par an</p>
          <p className="mt-1 font-display text-2xl">{money(monthly * 12)}</p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
          <p className="text-xs text-[var(--muted)]">Contreparties</p>
          <p className="mt-1 font-display text-2xl">{items.length}</p>
        </div>
      </div>

      {error ? (
        <Alert tone="error" title="Erreur">
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <HistoryListSkeleton />
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border-strong)] px-6 py-14 text-center">
          <p className="font-display text-2xl">Aucun abonnement détecté</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
            Analysez des contrats, factures ou assurances pour alimenter cette
            vue.
          </p>
          <Link
            href="/analyser"
            className="mt-6 inline-flex h-10 items-center rounded-lg bg-[var(--accent)] px-5 text-sm font-medium text-[var(--accent-foreground)]"
          >
            Analyser un PDF
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="surface-panel rounded-2xl px-5 py-4 text-left"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-[var(--foreground)]">
                    {item.name}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {item.category}
                    {" · "}
                    {item.documentCount} document
                    {item.documentCount > 1 ? "s" : ""}
                    {item.status === "possibly_replaced"
                      ? " · possiblement remplacé"
                      : ""}
                  </p>
                  {item.nextDeadline ? (
                    <p className="mt-2 text-sm text-[var(--foreground)]">
                      Prochaine échéance : {formatDate(item.nextDeadline.date)}{" "}
                      — {item.nextDeadline.label}
                    </p>
                  ) : null}
                  {item.terminationHint ? (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Résiliation : {item.terminationHint}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 text-left sm:text-right">
                  <p className="font-display text-xl">
                    {money(item.monthlyEur)}
                    <span className="text-sm text-[var(--muted)]"> / mois</span>
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {money(item.annualEur)} / an
                  </p>
                  {item.entityId ? (
                    <Link
                      href={`/contreparties/${item.entityId}`}
                      className="mt-2 inline-block text-xs font-medium text-[var(--accent)] hover:underline"
                    >
                      Timeline
                    </Link>
                  ) : null}
                  {item.primaryHistoryId ? (
                    <Link
                      href={`/historique/${item.primaryHistoryId}`}
                      className="mt-2 ml-3 inline-block text-xs text-[var(--muted)] hover:underline"
                    >
                      Document
                    </Link>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
