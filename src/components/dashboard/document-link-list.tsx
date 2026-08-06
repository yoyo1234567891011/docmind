import Link from "next/link";

import {
  DashboardPanel,
  getRiskToneClass,
} from "@/components/dashboard/dashboard-panel";
import { ChevronRightIcon } from "@/components/ui/icons";
import { formatDateTime, getRiskLevelLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HistoryListItem } from "@/types";

interface DocumentLinkListProps {
  title: string;
  subtitle: string;
  items: HistoryListItem[];
  emptyLabel: string;
  viewAllHref?: string;
  showActions?: boolean;
}

export function DocumentLinkList({
  title,
  subtitle,
  items,
  emptyLabel,
  viewAllHref,
  showActions = false,
}: DocumentLinkListProps) {
  return (
    <DashboardPanel
      title={title}
      subtitle={subtitle}
      action={
        viewAllHref ? (
          <Link
            href={viewAllHref}
            className="inline-flex items-center gap-1 text-sm text-[var(--accent)] transition-colors hover:underline"
          >
            Tout voir
            <ChevronRightIcon className="h-4 w-4" />
          </Link>
        ) : null
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/historique/${item.id}`}
                className="group flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0 transition-colors"
              >
                <div className="min-w-0 text-left">
                  <p className="truncate font-medium text-[var(--foreground)] group-hover:text-[var(--accent)]">
                    {item.title}
                  </p>
                  <p className="mt-1 truncate text-xs text-[var(--muted)]">
                    {item.categoryLabel} · {formatDateTime(item.analyzedAt)}
                    {showActions && item.actionCount > 0
                      ? ` · ${item.actionCount} action${item.actionCount > 1 ? "s" : ""}`
                      : null}
                    {showActions && item.replyRequired
                      ? " · réponse suggérée"
                      : null}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-xs font-medium",
                    getRiskToneClass(item.riskLevel),
                  )}
                >
                  {getRiskLevelLabel(item.riskLevel)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </DashboardPanel>
  );
}
