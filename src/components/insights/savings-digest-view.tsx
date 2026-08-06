"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Alert, Button, HistoryListSkeleton } from "@/components/ui";
import {
  fetchDigest,
  fetchLetterIntents,
  fetchSavings,
} from "@/lib/client/insights";
import { draftLetter } from "@/lib/client";
import type {
  MemoryDigest,
  RelationLetterIntent,
  SavingsOpportunity,
} from "@/types/insights";
import { LETTER_TYPE_LABELS } from "@/types";

function money(n: number | null): string {
  if (n == null) return "—";
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €`;
}

export function SavingsAndDigestView() {
  const [savings, setSavings] = useState<SavingsOpportunity[]>([]);
  const [digest, setDigest] = useState<MemoryDigest | null>(null);
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [letters, setLetters] = useState<RelationLetterIntent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [draftMsg, setDraftMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, d, l] = await Promise.all([
        fetchSavings(),
        fetchDigest(period),
        fetchLetterIntents(),
      ]);
      setSavings(s);
      setDigest(d);
      setLetters(l);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Impossible de charger les insights.",
      );
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const onDraft = async (intent: RelationLetterIntent) => {
    if (!intent.historyId) {
      setDraftMsg("Document historique introuvable pour ce courrier.");
      return;
    }
    setDraftingId(intent.id);
    setDraftMsg(null);
    try {
      await draftLetter({
        historyId: intent.historyId,
        letterType: intent.letterType,
      });
      setDraftMsg(
        `Courrier « ${LETTER_TYPE_LABELS[intent.letterType]} » généré — ouvrez le document.`,
      );
    } catch (err) {
      setDraftMsg(
        err instanceof Error ? err.message : "Génération du courrier impossible.",
      );
    } finally {
      setDraftingId(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="animate-fade-up text-left">
        <h1 className="font-display text-4xl tracking-tight sm:text-5xl">
          Économies & digests
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted)] sm:text-base">
          Pistes d’économies issues des relations mémoire, digests périodiques
          et courriers adaptés.
        </p>
      </div>

      {error ? (
        <Alert tone="error" title="Erreur">
          {error}
        </Alert>
      ) : null}
      {draftMsg ? (
        <Alert tone="info" title="Courrier">
          {draftMsg}
        </Alert>
      ) : null}

      {loading ? (
        <HistoryListSkeleton />
      ) : (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="font-display text-2xl tracking-tight">Digest</h2>
              <div className="flex gap-2">
                <Button
                  variant={period === "week" ? "primary" : "secondary"}
                  onClick={() => setPeriod("week")}
                >
                  7 jours
                </Button>
                <Button
                  variant={period === "month" ? "primary" : "secondary"}
                  onClick={() => setPeriod("month")}
                >
                  30 jours
                </Button>
              </div>
            </div>
            {digest ? (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 text-left">
                <p className="text-sm text-[var(--foreground)]">
                  {digest.summary}
                </p>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  {digest.from} → {digest.to} · {digest.newDocuments} docs ·{" "}
                  {digest.upcomingDeadlines} échéances · {digest.savingsCount}{" "}
                  économies
                </p>
                {digest.relationHighlights.length > 0 ? (
                  <ul className="mt-3 space-y-1">
                    {digest.relationHighlights.map((h, i) => (
                      <li key={`${h.kind}-${i}`} className="text-xs text-[var(--muted)]">
                        · {h.text}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-2xl tracking-tight">
              Économies potentielles
            </h2>
            {savings.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                Aucune piste d’économie pour le moment.
              </p>
            ) : (
              <ul className="space-y-3">
                {savings.map((s) => (
                  <li
                    key={s.id}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 text-left"
                  >
                    <p className="font-medium">{s.title}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {s.message}
                    </p>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      Économie estimée : {money(s.estimatedMonthlySavingEur)}
                      /mois · {s.documentTitle}
                    </p>
                    {s.historyId ? (
                      <Link
                        href={`/historique/${s.historyId}`}
                        className="mt-2 inline-block text-xs text-[var(--accent)] hover:underline"
                      >
                        Voir le document
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-2xl tracking-tight">
              Courriers suggérés
            </h2>
            {letters.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                Aucun courrier relationnel suggéré.
              </p>
            ) : (
              <ul className="space-y-3">
                {letters.map((intent) => (
                  <li
                    key={intent.id}
                    className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="text-left">
                      <p className="font-medium">{intent.title}</p>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {intent.reason}
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {LETTER_TYPE_LABELS[intent.letterType]} ·{" "}
                        {intent.recipient}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      disabled={!intent.historyId || draftingId === intent.id}
                      onClick={() => void onDraft(intent)}
                    >
                      {draftingId === intent.id
                        ? "Génération…"
                        : "Générer le courrier"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
