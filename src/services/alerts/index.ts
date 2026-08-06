import {
  detectAlertsForRecord,
  kindPriority,
  priorityRank,
  severityRank,
} from "@/services/alerts/detect";
import { listRelationAlerts } from "@/services/alerts/from-relations";
import { readAlertsState } from "@/services/alerts/state";
import { listHistoryRecords } from "@/services/history";
import { readNotificationPreferences } from "@/services/notifications/preferences";
import type {
  AlertKind,
  AlertPriority,
  AlertSeverity,
  AlertsListResult,
  AlertsSummary,
  DocumentAlert,
} from "@/types";

function emptySummary(): AlertsSummary {
  return {
    total: 0,
    unread: 0,
    byKind: {
      deadline_soon: 0,
      high_risk: 0,
      action_required: 0,
      renewal: 0,
      termination: 0,
      important_payment: 0,
      analysis_ready: 0,
      relation_duplicate: 0,
      relation_supersede: 0,
      relation_overlap_risk: 0,
      relation_redundant_payment: 0,
      relation_deadline_conflict: 0,
      relation_contradiction: 0,
    },
    bySeverity: {
      info: 0,
      warning: 0,
      critical: 0,
    },
    byPriority: {
      critique: 0,
      haute: 0,
      moyenne: 0,
      basse: 0,
    },
  };
}

function sortAlerts(alerts: DocumentAlert[]): DocumentAlert[] {
  return [...alerts].sort((a, b) => {
    const priority = priorityRank(b.priority) - priorityRank(a.priority);
    if (priority !== 0) return priority;
    const severity = severityRank(b.severity) - severityRank(a.severity);
    if (severity !== 0) return severity;
    const kind = kindPriority(b.kind) - kindPriority(a.kind);
    if (kind !== 0) return kind;
    return (a.date || a.dueDate || "").localeCompare(b.date || b.dueDate || "");
  });
}

/**
 * Generate live alerts from history + apply persisted read/dismissed state.
 */
export async function listDocumentAlerts(
  userId: string,
  options?: {
    includeDismissed?: boolean;
    kind?: AlertKind | "all";
  },
): Promise<AlertsListResult> {
  const includeDismissed = options?.includeDismissed ?? false;
  const kindFilter = options?.kind ?? "all";

  const [records, state, prefs] = await Promise.all([
    listHistoryRecords(userId),
    readAlertsState(userId),
    readNotificationPreferences(userId),
  ]);

  const readSet = new Set(state.readIds);
  const dismissedSet = new Set(state.dismissedIds);
  const now = new Date();

  let alerts = records.flatMap((record) => detectAlertsForRecord(record, now));

  // Alertes ponctuelles (analyse P2 prête, etc.)
  const pinned = (state.pinnedAlerts ?? []).map((alert) => ({
    ...alert,
    read: false,
    dismissed: false,
  }));
  alerts = [...pinned, ...alerts];

  // Alertes relationnelles P3 (arêtes mémoire)
  try {
    const relational = await listRelationAlerts(userId);
    alerts = [...alerts, ...relational];
  } catch {
    // mémoire absente / erreur non bloquante
  }

  if (!prefs.inAppEnabled) {
    alerts = [];
  } else {
    alerts = alerts.filter((alert) => prefs.kinds[alert.kind] !== false);
  }

  alerts = alerts.map((alert) => ({
    ...alert,
    read: readSet.has(alert.id),
    dismissed: dismissedSet.has(alert.id),
  }));

  if (!includeDismissed) {
    alerts = alerts.filter((alert) => !alert.dismissed);
  }

  if (kindFilter !== "all") {
    alerts = alerts.filter((alert) => alert.kind === kindFilter);
  }

  alerts = sortAlerts(alerts);

  const summary = emptySummary();
  summary.total = alerts.length;
  summary.unread = alerts.filter((alert) => !alert.read).length;

  for (const alert of alerts) {
    summary.byKind[alert.kind] += 1;
    summary.bySeverity[alert.severity as AlertSeverity] += 1;
    summary.byPriority[alert.priority as AlertPriority] += 1;
  }

  return {
    alerts,
    summary,
    generatedAt: now.toISOString(),
  };
}
