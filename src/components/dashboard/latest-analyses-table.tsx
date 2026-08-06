import Link from "next/link";

import {
  DashboardPanel,
  getRiskToneClass,
} from "@/components/dashboard/dashboard-panel";
import { ChevronRightIcon } from "@/components/ui/icons";
import { formatDateTime, getRiskLevelLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HistoryListItem } from "@/types";

interface LatestAnalysesTableProps {
  items: HistoryListItem[];
}

export function LatestAnalysesTable({ items }: LatestAnalysesTableProps) {
  return (
    <DashboardPanel
      title="Dernières analyses"
      subtitle="Vue détaillée des analyses les plus récentes"
      action={
        <Link
          href="/historique"
          className="inline-flex items-center gap-1 text-sm text-[var(--accent)] hover:underline"
        >
          Historique
          <ChevronRightIcon className="h-4 w-4" />
        </Link>
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          Aucune analyse pour le moment.
        </p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
                <th className="px-2 pb-3 font-medium">Document</th>
                <th className="px-2 pb-3 font-medium">Type</th>
                <th className="px-2 pb-3 font-medium">Risque</th>
                <th className="px-2 pb-3 font-medium">Actions</th>
                <th className="px-2 pb-3 font-medium">Date</th>
                <th className="px-2 pb-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <td className="px-2 py-3">
                    <p className="max-w-[220px] truncate font-medium text-[var(--foreground)]">
                      {item.title}
                    </p>
                    <p className="max-w-[220px] truncate text-xs text-[var(--muted)]">
                      {item.fileName}
                    </p>
                  </td>
                  <td className="px-2 py-3 text-[var(--muted)]">
                    {item.categoryLabel}
                  </td>
                  <td className="px-2 py-3">
                    <span
                      className={cn(
                        "inline-flex rounded-md px-2 py-0.5 text-xs font-medium",
                        getRiskToneClass(item.riskLevel),
                      )}
                    >
                      {getRiskLevelLabel(item.riskLevel)} · {item.riskScore}
                    </span>
                  </td>
                  <td className="px-2 py-3 text-[var(--muted)]">
                    {item.needsAction
                      ? item.actionCount > 0
                        ? `${item.actionCount}`
                        : "Oui"
                      : "—"}
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap text-[var(--muted)]">
                    {formatDateTime(item.analyzedAt)}
                  </td>
                  <td className="px-2 py-3 text-right">
                    <Link
                      href={`/historique/${item.id}`}
                      className="inline-flex items-center gap-1 font-medium text-[var(--accent)] hover:underline"
                    >
                      Ouvrir
                      <ChevronRightIcon className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardPanel>
  );
}
