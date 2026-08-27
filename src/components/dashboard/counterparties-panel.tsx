"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { DashboardPanel } from "@/components/dashboard/dashboard-panel";
import { ChevronRightIcon } from "@/components/ui/icons";
import {
  fetchCounterparties,
  type CounterpartyAggregate,
} from "@/lib/client/memory-timeline";

export function CounterpartiesPanel({
  refreshKey = 0,
}: {
  refreshKey?: number;
}) {
  const [items, setItems] = useState<CounterpartyAggregate[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchCounterparties();
      setItems(data.counterparties.slice(0, 6));
      setError(null);
    } catch (err) {
      // Erreur ≠ liste vide : conserver l’affichage précédent si présent.
      setError(
        err instanceof Error
          ? err.message
          : "Impossible de charger les contreparties.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <DashboardPanel
      title="Contreparties"
      subtitle="Historique agrégé (Orange, EDF, MAIF…)"
      action={
        <Link
          href="/contreparties"
          className="inline-flex items-center gap-1 text-sm text-[var(--accent)] hover:underline"
        >
          Voir tout
          <ChevronRightIcon className="h-4 w-4" />
        </Link>
      }
    >
      {error ? (
        <p className="text-sm text-[var(--danger)]">{error}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          Aucune contrepartie indexée pour le moment.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {items.map((item) => (
            <li key={item.entityId} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 text-left">
                  <p className="truncate font-medium text-[var(--foreground)]">
                    {item.name}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {item.documentCount} document
                    {item.documentCount > 1 ? "s" : ""}
                    {item.categories.length
                      ? ` · ${item.categories.slice(0, 3).join(", ")}`
                      : ""}
                    {item.familyCount
                      ? ` · ${item.familyCount} famille${item.familyCount > 1 ? "s" : ""}`
                      : ""}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-[var(--muted)]">
                  {(item.lastSeenAt || "").slice(0, 10)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </DashboardPanel>
  );
}
