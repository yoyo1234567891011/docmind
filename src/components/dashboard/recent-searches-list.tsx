"use client";

import Link from "next/link";

import { DashboardPanel } from "@/components/dashboard/dashboard-panel";
import { ChevronRightIcon, SearchIcon } from "@/components/ui/icons";
import type { RecentSearch } from "@/lib/client/recent-searches";
import { formatDateTime } from "@/lib/format";

interface RecentSearchesListProps {
  searches: RecentSearch[];
}

export function RecentSearchesList({ searches }: RecentSearchesListProps) {
  return (
    <DashboardPanel
      title="Recherches récentes"
      subtitle="Vos dernières requêtes en langage naturel"
      action={
        <Link
          href="/recherche"
          className="inline-flex items-center gap-1 text-sm text-[var(--accent)] hover:underline"
        >
          Rechercher
          <ChevronRightIcon className="h-4 w-4" />
        </Link>
      }
    >
      {searches.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          Aucune recherche récente. Essayez la recherche intelligente.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {searches.map((item) => (
            <li key={`${item.at}-${item.query}`}>
              <Link
                href={`/recherche?q=${encodeURIComponent(item.query)}`}
                className="group flex items-start gap-3 py-3 first:pt-0 last:pb-0"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                  <SearchIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate font-medium text-[var(--foreground)] group-hover:text-[var(--accent)]">
                    {item.query}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {formatDateTime(item.at)}
                    {typeof item.hitCount === "number"
                      ? ` · ${item.hitCount} résultat${item.hitCount > 1 ? "s" : ""}`
                      : null}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardPanel>
  );
}
