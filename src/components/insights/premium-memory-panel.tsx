"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { DashboardPanel } from "@/components/dashboard/dashboard-panel";
import { Alert } from "@/components/ui";
import { ChevronRightIcon } from "@/components/ui/icons";
import { fetchInsightsOverview } from "@/lib/client/insights";
import type { PremiumMemoryDashboard } from "@/types/insights";

function money(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`;
}

export function PremiumMemoryPanel({
  refreshKey = 0,
}: {
  refreshKey?: number;
}) {
  const [data, setData] = useState<PremiumMemoryDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchInsightsOverview());
      setError(null);
    } catch (err) {
      // Ne pas effacer les données précédentes : erreur ≠ zéro.
      setError(
        err instanceof Error
          ? err.message
          : "Insights mémoire indisponibles.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (loading && !data && !error) {
    return (
      <DashboardPanel
        title="Mémoire documentaire"
        subtitle="Chargement…"
      >
        <p className="text-sm text-[var(--muted)]">Chargement des insights…</p>
      </DashboardPanel>
    );
  }

  if (error && !data) {
    return (
      <DashboardPanel
        title="Mémoire documentaire"
        subtitle="Données indisponibles"
      >
        <Alert tone="error" title="Erreur de chargement">
          {error}
        </Alert>
      </DashboardPanel>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <DashboardPanel
      title="Mémoire documentaire"
      subtitle="Ce qu’un chat IA seul ne peut pas reconstruire"
      action={
        <Link
          href="/abonnements"
          className="inline-flex items-center gap-1 text-sm text-[var(--accent)] hover:underline"
        >
          Abonnements
          <ChevronRightIcon className="h-4 w-4" />
        </Link>
      }
    >
      {error ? (
        <Alert tone="info" title="Actualisation partielle">
          {error} — affichage de la dernière version connue.
        </Alert>
      ) : null}
      <div className={`grid gap-3 md:grid-cols-3${error ? " mt-3" : ""}`}>
        <div>
          <p className="text-xs text-[var(--muted)]">Dépenses / mois</p>
          <p className="font-display text-xl">{money(data.monthlySpendEur)}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--muted)]">Pistes d’économie</p>
          <p className="font-display text-xl">{data.savingsCount}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--muted)]">Contradictions</p>
          <p className="font-display text-xl">{data.contradictionCount}</p>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {data.uniqueValuePoints.slice(0, 4).map((point) => (
          <li key={point} className="text-sm text-[var(--muted)]">
            · {point}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-3 text-xs">
        <Link href="/finances" className="text-[var(--accent)] hover:underline">
          Finances
        </Link>
        <Link
          href="/economies"
          className="text-[var(--accent)] hover:underline"
        >
          Économies & digests
        </Link>
        <Link
          href="/contreparties"
          className="text-[var(--accent)] hover:underline"
        >
          Timelines
        </Link>
      </div>
    </DashboardPanel>
  );
}
