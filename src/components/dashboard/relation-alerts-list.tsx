import Link from "next/link";
import { useMemo } from "react";

import { DashboardPanel } from "@/components/dashboard/dashboard-panel";
import { AlertIcon, ChevronRightIcon } from "@/components/ui/icons";
import {
  collapseRelationAlerts,
  softenRedundantPaymentTypeLabel,
  type RelationAlertDisplay,
} from "@/lib/dashboard-display";
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

function kindLabel(alert: DocumentAlert): string {
  if (alert.kind === "relation_redundant_payment") {
    if (/facture\s+li[eé]e/i.test(alert.title)) {
      return "Facture liée";
    }
    return softenRedundantPaymentTypeLabel(true);
  }
  return ALERT_KIND_LABELS[alert.kind];
}

export function RelationAlertsList({ alerts }: RelationAlertsListProps) {
  const displayAlerts: RelationAlertDisplay[] = useMemo(
    () => collapseRelationAlerts(alerts),
    [alerts],
  );

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
      {displayAlerts.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          Aucune relation à surveiller pour le moment.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {displayAlerts.map((alert) => (
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
                    {alert.duplicateCount && alert.duplicateCount > 1 ? (
                      <span className="ml-1.5 rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted)]">
                        ×{alert.duplicateCount}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                    {kindLabel(alert)}
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
