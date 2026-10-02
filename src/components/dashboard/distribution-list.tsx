import {
  DashboardPanel,
  getRiskBarClass,
} from "@/components/dashboard/dashboard-panel";
import type { NamedCount } from "@/lib/dashboard-stats";
import { cn } from "@/lib/utils";

interface DistributionListProps {
  title: string;
  subtitle: string;
  items: NamedCount[];
  emptyLabel: string;
  toneById?: boolean;
}

export function DistributionList({
  title,
  subtitle,
  items,
  emptyLabel,
  toneById = false,
}: DistributionListProps) {
  return (
    <DashboardPanel title={title} subtitle={subtitle}>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{emptyLabel}</p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.id} className="group">
              <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-[var(--foreground)]">
                  {item.label}
                </span>
                <span className="font-mono text-xs tabular-nums text-[var(--muted)] transition-colors group-hover:text-[var(--foreground)]">
                  {item.count} · {item.percent}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--muted)_14%,transparent)]">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out)]",
                    toneById ? getRiskBarClass(item.id) : "bg-[var(--accent)]",
                  )}
                  style={{ width: `${item.percent}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </DashboardPanel>
  );
}
