import Link from "next/link";

import { DashboardPanel } from "@/components/dashboard/dashboard-panel";
import { AlertIcon, ChevronRightIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import type { DocumentAlert } from "@/types";
import { ALERT_KIND_LABELS } from "@/types";

interface RelationAlertsListProps {
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

export function RelationAlertsList({ alerts }: RelationAlertsListProps) {
  return (
    <DashboardPanel
      title="Relations détectées"
      subtitle="Doublons, garanties, paiements et échéances liés"
      action={
        <Link
          href="/alertes"
          className="inline-flex items-center gap-1 text-sm text-[var(--accent)] hover:underline"
        >
          Alertes
          <ChevronRightIcon className="h-4 w-4" />
        </Link>
      }
    >
      {alerts.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          Aucune relation à surveiller pour le moment.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {alerts.map((alert) => (
            <li key={alert.id}>
              <Link
                href={`/historique/${alert.historyId}`}
                className="group flex items-start gap-3 py-3 first:pt-0 last:pb-0"
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                    severityClass(alert.severity),
                  )}
                >
                  <AlertIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate font-medium text-[var(--foreground)] group-hover:text-[var(--accent)]">
                    {alert.title}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                    {ALERT_KIND_LABELS[alert.kind]}
                    {" · "}
                    {alert.documentTitle}
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
