"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Alert, Button, Skeleton } from "@/components/ui";
import {
  applyDocumentRelationAction,
  fetchDocumentRelations,
  type RelationListItem,
  type RelationsUiPayload,
  type RelationUiAction,
} from "@/lib/client/relations";
import { cn } from "@/lib/utils";

interface DocumentRelationsPanelProps {
  documentId: string;
  /** Phase initiale (history) — poll tant que pending. */
  relationsPhase?: "pending" | "ready" | "failed";
  className?: string;
}

function confidenceTone(
  label: RelationListItem["confidenceLabel"],
): string {
  if (label === "Élevé") {
    return "bg-[var(--success-soft)] text-[var(--success)]";
  }
  if (label === "Moyen") {
    return "bg-[var(--warning-soft)] text-[var(--warning)]";
  }
  return "bg-[var(--accent-soft)] text-[var(--muted)]";
}

function RelationSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Calcul des relations">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <Skeleton className="h-20 w-full rounded-xl" />
    </div>
  );
}

function EvidenceList({ item }: { item: RelationListItem }) {
  if (item.evidence.length === 0) return null;
  return (
    <details className="mt-3 text-xs text-[var(--muted)]">
      <summary className="cursor-pointer select-none hover:text-[var(--foreground)]">
        Preuves ({item.evidence.length})
      </summary>
      <ul className="mt-2 space-y-1.5 border-l border-[var(--border)] pl-3">
        {item.evidence.map((ev, i) => (
          <li key={`${ev.field}-${i}`}>
            <span className="font-medium text-[var(--foreground)]">
              {ev.field}
            </span>
            {": "}
            <span>{ev.left}</span>
            {ev.right ? (
              <>
                {" → "}
                <span>{ev.right}</span>
              </>
            ) : null}
            {ev.note ? (
              <span className="block text-[var(--muted)]">{ev.note}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function RelationCard({
  item,
  documentId,
  busyId,
  onAction,
}: {
  item: RelationListItem;
  documentId: string;
  busyId: string | null;
  onAction: (id: string, action: RelationUiAction) => void;
}) {
  const peerHref = item.peer.historyId
    ? `/historique/${item.peer.historyId}`
    : null;
  const busy = busyId === item.id;

  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--accent)]">
          {item.typeLabel}
        </span>
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[11px] font-medium",
            confidenceTone(item.confidenceLabel),
          )}
        >
          Confiance {item.confidenceLabel}
        </span>
        <span className="text-[11px] tabular-nums text-[var(--muted)]">
          score {(item.score * 100).toFixed(0)}%
        </span>
        {item.status === "user_confirmed" ? (
          <span className="text-[11px] text-[var(--success)]">Confirmé</span>
        ) : null}
      </div>

      <p className="mt-2 text-sm leading-relaxed text-[var(--foreground)]">
        {item.message}
      </p>

      <p className="mt-2 text-xs text-[var(--muted)]">
        Documents :{" "}
        <span className="text-[var(--foreground)]">ce document</span>
        {" · "}
        {peerHref ? (
          <Link
            href={peerHref}
            className="text-[var(--accent)] hover:underline"
          >
            {item.peer.title}
          </Link>
        ) : (
          <span className="text-[var(--foreground)]">{item.peer.title}</span>
        )}
      </p>

      <EvidenceList item={item} />

      {item.status === "proposed" || item.status === "user_snoozed" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => onAction(item.id, "confirm")}
          >
            Confirmer
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => onAction(item.id, "dismiss")}
          >
            Ce n’est pas lié
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onAction(item.id, "snooze")}
          >
            Masquer temporairement
          </Button>
          {peerHref ? (
            <Link
              href={peerHref}
              className="inline-flex h-8 items-center px-2 text-xs text-[var(--accent)] hover:underline"
            >
              Voir l’autre document
            </Link>
          ) : null}
        </div>
      ) : item.status === "user_confirmed" && peerHref ? (
        <div className="mt-3">
          <Link
            href={peerHref}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            Voir l’autre document
          </Link>
        </div>
      ) : null}

      <span className="sr-only">
        Relation {item.type} pour {documentId}
      </span>
    </article>
  );
}

export function DocumentRelationsPanel({
  documentId,
  relationsPhase: initialPhase,
  className,
}: DocumentRelationsPanelProps) {
  const [data, setData] = useState<RelationsUiPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await fetchDocumentRelations(documentId);
      setData(payload);
      setError(null);
      return payload;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Impossible de charger les relations.",
      );
      return null;
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (cancelled) return;
      const payload = await load();
      if (cancelled || !payload) return;
      if (payload.relationsPhase === "pending") {
        timer = setTimeout(() => void tick(), 1500);
      }
    };

    setLoading(true);
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [documentId, load, initialPhase]);

  const onAction = async (relationId: string, action: RelationUiAction) => {
    setBusyId(relationId);
    setError(null);
    try {
      await applyDocumentRelationAction(documentId, relationId, action);
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Action impossible.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const phase = data?.relationsPhase ?? initialPhase ?? "pending";
  const relations = data?.relations ?? [];
  const showSkeleton = loading || phase === "pending";
  const showEmpty =
    !showSkeleton &&
    !error &&
    phase === "ready" &&
    relations.length === 0;
  const showFailed = !showSkeleton && phase === "failed" && relations.length === 0;

  return (
    <section
      className={cn(
        "animate-fade-up surface-panel rounded-2xl text-left",
        className,
      )}
      aria-label="Relations avec vos autres documents"
    >
      <header className="border-b border-[var(--border)] px-5 py-4">
        <h3 className="font-display text-xl tracking-tight text-[var(--foreground)]">
          Relations avec vos autres documents
        </h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Suggestions basées sur vos documents — pas une affirmation juridique.
        </p>
      </header>

      <div className="space-y-3 px-5 py-4">
        {error ? (
          <Alert tone="error" title="Relations">
            {error}
          </Alert>
        ) : null}

        {showSkeleton ? <RelationSkeleton /> : null}

        {showFailed ? (
          <p className="text-sm text-[var(--muted)]">
            Le calcul des relations a échoué. Réessayez plus tard — votre
            analyse reste disponible.
          </p>
        ) : null}

        {showEmpty ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-5">
            <p className="text-sm text-[var(--foreground)]">
              Aucun lien pertinent pour l’instant.
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {data && data.sameCategoryCount > 0
                ? `${data.sameCategoryCount} document${data.sameCategoryCount > 1 ? "s" : ""} dans la même catégorie — aucun doublon ni renouvellement détecté.`
                : "Ajoutez d’autres documents pour détecter doublons, renouvellements et contreparties communes."}
            </p>
          </div>
        ) : null}

        {!showSkeleton && relations.length > 0 ? (
          <ul className="space-y-3">
            {relations.map((item) => (
              <li key={item.id}>
                <RelationCard
                  item={item}
                  documentId={documentId}
                  busyId={busyId}
                  onAction={(id, action) => void onAction(id, action)}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
