"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Alert, Skeleton } from "@/components/ui";
import {
  fetchDocumentTimeline,
  type TimelineEvent,
} from "@/lib/client/memory-timeline";
import { cn } from "@/lib/utils";

interface DocumentTimelinePanelProps {
  documentId: string;
  className?: string;
}

const KIND_LABEL: Record<TimelineEvent["kind"], string> = {
  document: "Document",
  deadline: "Échéance",
  supersedes: "Remplacement",
  amends: "Avenant",
  contradicts_clause: "Contradiction",
  obsoletes_fact: "Fait obsolète",
  invoice_for: "Facture liée",
  other_relation: "Relation",
};

function kindTone(kind: TimelineEvent["kind"]): string {
  if (kind === "contradicts_clause") {
    return "text-[var(--danger)] bg-[var(--danger-soft)]";
  }
  if (kind === "supersedes" || kind === "obsoletes_fact") {
    return "text-[var(--warning)] bg-[var(--warning-soft)]";
  }
  if (kind === "deadline") {
    return "text-[var(--accent)] bg-[var(--accent-soft)]";
  }
  return "text-[var(--muted)] bg-[var(--background)]";
}

export function DocumentTimelinePanel({
  documentId,
  className,
}: DocumentTimelinePanelProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDocumentTimeline(documentId);
      setEvents(data.events);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Impossible de charger la timeline.",
      );
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      className={cn(
        "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5",
        className,
      )}
    >
      <div className="mb-4 text-left">
        <h3 className="font-display text-xl tracking-tight">
          Timeline documentaire
        </h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Chronologie des contrats, échéances et relations pour les
          contreparties liées.
        </p>
      </div>

      {error ? (
        <Alert tone="error" title="Erreur">
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
      ) : events.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          Pas encore d’événements pour ce document.
        </p>
      ) : (
        <ol className="relative space-y-0 border-l border-[var(--border)] pl-4">
          {events.map((event) => (
            <li key={event.id} className="relative pb-4 last:pb-0">
              <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[11px] font-medium",
                    kindTone(event.kind),
                  )}
                >
                  {KIND_LABEL[event.kind]}
                </span>
                <time className="text-[11px] text-[var(--muted)]">
                  {event.at.slice(0, 10)}
                </time>
              </div>
              <p className="mt-1 text-sm text-[var(--foreground)]">
                {event.label}
              </p>
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
  );
}
