"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { getRiskToneClass } from "@/components/dashboard/dashboard-panel";
import { SearchQuotaBanner } from "@/components/search/search-quota-banner";
import { Alert, Button } from "@/components/ui";
import { ChevronRightIcon, SearchIcon, SpinnerIcon } from "@/components/ui/icons";
import {
  fetchMe,
  fetchQuotas,
  isQuotaExceededError,
  smartSearch,
} from "@/lib/client";
import type { QuotaStatus } from "@/lib/client/quotas";
import { recordRecentSearch } from "@/lib/client/recent-searches";
import { formatDateTime, getRiskLevelLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SmartSearchResult } from "@/types";

const EXAMPLES = [
  "Quels contrats expirent cette année ?",
  "Montre toutes les factures EDF.",
  "Quels abonnements dépassent 40 € ?",
  "Quels documents contiennent une clause de renouvellement automatique ?",
] as const;

export function SmartSearchView() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q")?.trim() ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<SmartSearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaError, setQuotaError] = useState(false);
  const [quotas, setQuotas] = useState<QuotaStatus | null>(null);
  const autoRan = useRef(false);

  const refreshQuotas = useCallback(async () => {
    try {
      const data = await fetchQuotas();
      setQuotas(data);
    } catch {
      // Non bloquant — la recherche reste utilisable.
    }
  }, []);

  useEffect(() => {
    void refreshQuotas();
  }, [refreshQuotas]);

  const searchQuota = quotas?.items.find((i) => i.metric === "search");
  const searchExhausted =
    searchQuota != null &&
    !searchQuota.unlimited &&
    searchQuota.remaining <= 0;

  const run = async (nextQuery: string) => {
    const trimmed = nextQuery.trim();
    if (!trimmed) return;

    setQuery(trimmed);
    setIsLoading(true);
    setError(null);
    setQuotaError(false);

    try {
      const data = await smartSearch({ query: trimmed });
      setResult(data);
      const me = await fetchMe().catch(() => null);
      recordRecentSearch(trimmed, data.total, me?.user?.id);
      await refreshQuotas();
    } catch (searchError) {
      setResult(null);
      if (isQuotaExceededError(searchError)) {
        setQuotaError(true);
        setError(searchError.message);
        await refreshQuotas();
      } else {
        setError(
          searchError instanceof Error
            ? searchError.message
            : "La recherche intelligente a échoué.",
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (autoRan.current || !initialQuery) return;
    autoRan.current = true;
    void run(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once from ?q=
  }, [initialQuery]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void run(query);
  };

  return (
    <div className="space-y-6">
      <div className="animate-fade-up text-left">
        <h1 className="font-display text-4xl tracking-tight text-[var(--foreground)] sm:text-5xl">
          Recherche intelligente
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)] sm:text-base">
          Posez votre question en langage naturel. DocMind interroge d’abord vos
          fiches structurées, puis le texte des documents seulement si besoin.
        </p>
      </div>

      {quotas ? <SearchQuotaBanner quotas={quotas} /> : null}

      <form
        onSubmit={handleSubmit}
        className="surface-panel animate-fade-up-delay-1 rounded-2xl p-4 sm:p-5"
      >
        <label className="block text-left">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
            Votre requête
          </span>
          <div className="flex flex-col gap-3 md:flex-row">
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder='Ex. "Quels contrats expirent cette année ?"'
                className="h-11 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] py-2 pl-10 pr-3 text-sm outline-none transition-colors focus:border-[var(--accent)]"
              />
            </div>
            <Button
              type="submit"
              disabled={isLoading || !query.trim() || searchExhausted}
            >
              {isLoading ? (
                <>
                  <SpinnerIcon className="h-4 w-4" />
                  Recherche…
                </>
              ) : (
                "Rechercher"
              )}
            </Button>
          </div>
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              disabled={searchExhausted}
              onClick={() => {
                void run(example);
              }}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-left text-xs text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {example}
            </button>
          ))}
        </div>
      </form>

      {error ? (
        <Alert
          tone="error"
          title={quotaError ? "Quota recherche atteint" : "Recherche impossible"}
        >
          {error}
          {quotaError ? (
            <Link
              href="/facturation"
              className="mt-2 inline-block font-medium text-[var(--accent)] underline-offset-2 hover:underline"
            >
              Voir les offres
            </Link>
          ) : null}
        </Alert>
      ) : null}

      {result ? (
        <div className="space-y-4 animate-fade-up">
          <div className="surface-panel rounded-2xl p-5 text-left">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
              Intention détectée
            </p>
            <p className="mt-2 font-display text-xl text-[var(--foreground)]">
              {result.intent.interpretedAs}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
              <span className="rounded-md bg-[var(--accent-soft)] px-2 py-1 text-[var(--accent)]">
                source : {result.intent.source}
              </span>
              <span className="rounded-md border border-[var(--border)] px-2 py-1">
                {result.total} résultat{result.total > 1 ? "s" : ""}
              </span>
              <span className="rounded-md border border-[var(--border)] px-2 py-1">
                {result.tookMs} ms
              </span>
              {result.intent.organizations.map((org) => (
                <span
                  key={org}
                  className="rounded-md border border-[var(--border)] px-2 py-1"
                >
                  org : {org}
                </span>
              ))}
              {result.intent.amount ? (
                <span className="rounded-md border border-[var(--border)] px-2 py-1">
                  montant {result.intent.amount.operator}{" "}
                  {result.intent.amount.value} €
                </span>
              ) : null}
              {result.intent.date?.year ? (
                <span className="rounded-md border border-[var(--border)] px-2 py-1">
                  échéance {result.intent.date.year}
                </span>
              ) : null}
              {result.stats ? (
                <span className="rounded-md border border-[var(--border)] px-2 py-1">
                  fiches {result.stats.fromSheets}
                  {result.stats.fromDocuments > 0
                    ? ` · docs ${result.stats.fromDocuments}`
                    : ""}
                </span>
              ) : null}
            </div>
          </div>

          {result.hits.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-12 text-center">
              <p className="font-display text-2xl text-[var(--foreground)]">
                Aucun document trouvé
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
                Essayez une autre formulation, ou analysez d’abord les documents
                concernés.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {result.hits.map((hit) => (
                <li
                  key={hit.item.id}
                  className="surface-panel rounded-2xl px-5 py-4 text-left"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-[var(--foreground)]">
                          {hit.item.title}
                        </p>
                        <span
                          className={cn(
                            "rounded-md px-2 py-0.5 text-xs font-medium",
                            getRiskToneClass(hit.item.riskLevel),
                          )}
                        >
                          {getRiskLevelLabel(hit.item.riskLevel)}
                        </span>
                        <span className="text-xs text-[var(--muted)]">
                          score {hit.score}
                        </span>
                        <span className="rounded-md border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">
                          {hit.matchedOn === "sheet"
                            ? "via fiche"
                            : "via document"}
                        </span>
                      </div>
                      <p className="text-sm text-[var(--muted)]">
                        {hit.item.fileName} · {hit.item.categoryLabel} ·{" "}
                        {formatDateTime(hit.item.analyzedAt)}
                      </p>
                      <ul className="flex flex-wrap gap-2">
                        {hit.reasons.map((reason) => (
                          <li
                            key={`${hit.item.id}-${reason.code}-${reason.label}`}
                            className="rounded-md bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted)]"
                          >
                            {reason.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <Link
                      href={`/historique/${hit.item.id}`}
                      className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-[var(--border-strong)] px-4 text-sm font-medium transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    >
                      Ouvrir
                      <ChevronRightIcon className="h-4 w-4" />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
