"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, HistoryListSkeleton } from "@/components/ui";
import { fetchSubscriptions } from "@/lib/client/insights";
import { formatDate } from "@/lib/format";
import type { SubscriptionInsight } from "@/types/insights";

const CATEGORY_LABELS: Record<string, string> = {
  assurance: "Assurance",
  contrat: "Abonnement / contrat",
  facture: "Facture récurrente",
  banque: "Banque",
  bail: "Logement",
  autre: "Autre",
};

function sumReliableMonthly(items: SubscriptionInsight[]): number | null {
  let sum = 0;
  let hasAny = false;
  for (const item of items) {
    if (item.monthlyEur != null && item.monthlyEur > 0) {
      sum += item.monthlyEur;
      hasAny = true;
    }
  }
  return hasAny ? Math.round(sum * 100) / 100 : null;
}

function formatMoney(n: number): string {
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €`;
}

function formatTotal(n: number | null): string {
  if (n == null) return "Non détecté";
  return formatMoney(n);
}

function formatItemAmount(n: number | null): string {
  if (n == null) return "Non détecté";
  return formatMoney(n);
}

function statusHint(item: SubscriptionInsight): string | null {
  if (item.status === "possibly_replaced") return "possiblement remplacé";
  return null;
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

  const monthlyTotal = useMemo(() => sumReliableMonthly(items), [items]);
  const annualTotal =
    monthlyTotal != null ? Math.round(monthlyTotal * 12 * 100) / 100 : null;
  const reliableCount = items.filter(
    (i) => i.monthlyEur != null && i.monthlyEur > 0,
  ).length;

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

      {!loading && items.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
            <p className="text-xs text-[var(--muted)]">Par mois</p>
            <p className="mt-1 font-display text-2xl">{formatTotal(monthlyTotal)}</p>
            {reliableCount > 0 && reliableCount < items.length ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                {reliableCount} montant{reliableCount > 1 ? "s fiables" : " fiable"}{" "}
                sur {items.length}
              </p>
            ) : null}
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
            <p className="text-xs text-[var(--muted)]">Par an</p>
            <p className="mt-1 font-display text-2xl">{formatTotal(annualTotal)}</p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
            <p className="text-xs text-[var(--muted)]">Contreparties</p>
            <p className="mt-1 font-display text-2xl">{items.length}</p>
          </div>
        </div>
      ) : null}

      {error ? (
        <Alert tone="error" title="Erreur">
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <HistoryListSkeleton />
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border-strong)] px-6 py-14 text-center">
          <p className="font-display text-2xl">
            Aucun abonnement détecté dans vos documents
          </p>
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
          {items.map((item) => {
            const hint = statusHint(item);
            return (
              <li
                key={item.id}
                className="surface-panel rounded-2xl px-5 py-4 text-left"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-[var(--foreground)]">
                      {item.name}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {CATEGORY_LABELS[item.category] ?? item.category}
                      {" · "}
                      {item.documentCount} document
                      {item.documentCount > 1 ? "s" : ""}
                      {hint ? ` · ${hint}` : ""}
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
                      {formatItemAmount(item.monthlyEur)}
                      <span className="text-sm text-[var(--muted)]"> / mois</span>
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {formatItemAmount(item.annualEur)} / an
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
            );
          })}
        </ul>
      )}
    </div>
  );
}
