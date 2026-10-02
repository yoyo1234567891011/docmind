import Link from "next/link";

import { DashboardPanel } from "@/components/dashboard/dashboard-panel";
import { AlertIcon, ChevronRightIcon } from "@/components/ui/icons";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DocumentAlert } from "@/types";
import { ALERT_KIND_LABELS } from "@/types";

interface DeadlineListProps {
  alerts: DocumentAlert[];
}

function severityClass(severity: DocumentAlert["severity"]): string {
  switch (severity) {
    case "critical":
      return "text-[var(--danger)] bg-[var(--danger-soft)]";
    case "warning":
      return "text-[var(--warning)] bg-[var(--warning-soft)]";
    default:
      return "text-[var(--accent)] bg-[var(--accent-soft)]";
  }
}

export function DeadlineList({ alerts }: DeadlineListProps) {
  return (
    <DashboardPanel
      title="Échéances proches"
      subtitle="Dates et renouvellements à surveiller"
      action={
        <Link
          href="/alertes?focus=echeances"
          className="ui-link-arrow"
        >
          Mes échéances
          <ChevronRightIcon className="h-4 w-4" />
        </Link>
      }
    >
      {alerts.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          Aucune échéance proche pour le moment.
        </p>
      ) : (
        <ul className="-mx-2 divide-y divide-[var(--hairline)]">
          {alerts.map((alert) => (
            <li key={alert.id}>
              <Link
                href={`/historique/${alert.historyId}`}
                className="group flex items-start gap-3 rounded-[var(--radius-md)] px-2 py-3 transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--foreground)_3%,transparent)]"
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] shadow-[var(--highlight)]",
                    severityClass(alert.severity),
                  )}
                >
                  <AlertIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate font-medium text-[var(--foreground)] group-hover:text-[var(--accent)]">
                    {alert.documentTitle || alert.title}
                  </p>
                  <p className="mt-0.5 truncate text-xs tabular-nums text-[var(--muted)]">
                    {ALERT_KIND_LABELS[alert.kind]}
                    {alert.dueDate ? ` · ${formatDate(alert.dueDate)}` : null}
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
