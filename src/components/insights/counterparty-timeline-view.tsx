"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Alert, HistoryListSkeleton, Skeleton } from "@/components/ui";
import {
  fetchCounterparties,
  type CounterpartyAggregate,
} from "@/lib/client/memory-timeline";
import { fetchEntityTimeline } from "@/lib/client/insights";
import { cn } from "@/lib/utils";
import type { MemoryTimelineEvent } from "@/types/memory";

const KIND_LABEL: Record<MemoryTimelineEvent["kind"], string> = {
  document: "Document",
  deadline: "Échéance",
  supersedes: "Remplacement",
  amends: "Avenant",
  contradicts_clause: "Contradiction",
  obsoletes_fact: "Fait obsolète",
  invoice_for: "Facture",
  other_relation: "Relation",
};

interface CounterpartyTimelineViewProps {
  entityId?: string;
}

export function CounterpartyTimelineView({
  entityId,
}: CounterpartyTimelineViewProps) {
  const [counterparties, setCounterparties] = useState<
    CounterpartyAggregate[]
  >([]);
  const [selectedId, setSelectedId] = useState<string | null>(entityId ?? null);
  const [events, setEvents] = useState<MemoryTimelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);

  useEffect(() => {
    if (entityId) setSelectedId(entityId);
  }, [entityId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const data = await fetchCounterparties();
        if (cancelled) return;
        setCounterparties(data.counterparties);
        setSelectedId((current) => {
          if (current) return current;
          return data.counterparties[0]?.entityId ?? null;
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Impossible de charger les contreparties.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadEvents = useCallback(async (id: string) => {
    setLoadingEvents(true);
    setError(null);
    try {
      setEvents(await fetchEntityTimeline(id));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Impossible de charger la timeline.",
      );
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadEvents(selectedId);
  }, [selectedId, loadEvents]);

  const selected = counterparties.find((c) => c.entityId === selectedId);

  return (
    <div className="space-y-6">
      <div className="animate-fade-up text-left">
        <h1 className="font-display text-4xl tracking-tight sm:text-5xl">
          Timeline par contrepartie
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted)] sm:text-base">
          Contrats, avenants, factures, courriers et échéances — chronologie
          complète issue de la mémoire documentaire.
        </p>
      </div>

      {error ? (
        <Alert tone="error" title="Erreur">
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <HistoryListSkeleton />
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          <aside className="lg:col-span-4">
            <ul className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
              {counterparties.map((c) => (
                <li key={c.entityId}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(c.entityId)}
                    className={cn(
                      "w-full px-4 py-3 text-left transition-colors",
                      selectedId === c.entityId
                        ? "bg-[var(--accent-soft)]"
                        : "hover:bg-[var(--background)]",
                    )}
                  >
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {c.documentCount} doc
                      {c.documentCount > 1 ? "s" : ""}
                      {c.categories.length
                        ? ` · ${c.categories.slice(0, 2).join(", ")}`
                        : ""}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <section className="lg:col-span-8">
            {selected ? (
              <div className="mb-4 text-left">
                <h2 className="font-display text-2xl">{selected.name}</h2>
                <p className="text-sm text-[var(--muted)]">
                  {selected.firstSeenAt?.slice(0, 10)} →{" "}
                  {selected.lastSeenAt?.slice(0, 10)}
                </p>
              </div>
            ) : null}

            {loadingEvents ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
              </div>
            ) : events.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                Aucun événement pour cette contrepartie.
              </p>
            ) : (
              <ol className="relative space-y-0 border-l border-[var(--border)] pl-4">
                {events.map((event) => (
                  <li key={event.id} className="relative pb-4 last:pb-0">
                    <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-[var(--background)] px-2 py-0.5 text-[11px]">
                        {KIND_LABEL[event.kind]}
                      </span>
                      <time className="text-[11px] text-[var(--muted)]">
                        {event.at.slice(0, 10)}
                      </time>
                    </div>
                    <p className="mt-1 text-sm">{event.label}</p>
                    {event.historyId ? (
                      <Link
                        href={`/historique/${event.historyId}`}
                        className="mt-1 inline-block text-xs text-[var(--accent)] hover:underline"
                      >
                        Ouvrir
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
