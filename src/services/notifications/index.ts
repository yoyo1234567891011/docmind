import { detectAlertsForRecord } from "@/services/alerts/detect";
import { pinAlert } from "@/services/alerts/state";
import { dispatchNotifications } from "@/services/notifications/dispatcher";
import {
  readNotificationPreferences,
} from "@/services/notifications/preferences";
import type { DocumentAlert, HistoryRecord } from "@/types";
import type {
  AppNotification,
  NotificationChannelId,
} from "@/types/notification";

export {
  readNotificationPreferences,
  updateNotificationPreferences,
} from "@/services/notifications/preferences";
export {
  dispatchNotification,
  dispatchNotifications,
} from "@/services/notifications/dispatcher";
export {
  processEmailOutbox,
  listPendingOutbox,
} from "@/services/notifications/outbox";
export { createEmailChannel } from "@/services/notifications/channels/email";

const DEFAULT_CHANNELS: NotificationChannelId[] = ["in_app", "email"];

export function toAppNotification(alert: DocumentAlert): AppNotification {
  return {
    id: alert.id,
    kind: alert.kind,
    severity: alert.severity,
    title: alert.title,
    message: alert.message,
    historyId: alert.historyId,
    documentTitle: alert.documentTitle,
    fileName: alert.fileName,
    evidence: alert.evidence,
    dueDate: alert.dueDate,
    amount: alert.amount,
    createdAt: alert.createdAt,
    read: alert.read,
    dismissed: alert.dismissed,
    channels: DEFAULT_CHANNELS,
  };
}

/**
 * After a document is analyzed: detect notifications and dispatch to channels.
 * In-app is always available via /api/alerts; email goes to outbox when enabled.
 */
export async function notifyForHistoryRecord(
  userId: string,
  record: HistoryRecord,
  options?: { userEmail?: string | null },
): Promise<AppNotification[]> {
  const prefs = await readNotificationPreferences(userId);
  const alerts = detectAlertsForRecord(record);
  const notifications = alerts
    .map(toAppNotification)
    .filter((item) => prefs.kinds[item.kind] !== false);

  if (notifications.length > 0) {
    await dispatchNotifications(userId, notifications, options);
  }

  return notifications;
}

/**
 * Notification dédiée : l’analyse juridique complète (P2) est prête.
 */
export async function notifyAnalysisReady(
  userId: string,
  record: HistoryRecord,
  options?: { userEmail?: string | null },
): Promise<AppNotification | null> {
  const prefs = await readNotificationPreferences(userId);
  if (prefs.kinds.analysis_ready === false) return null;

  const title =
    record.displayName?.trim() ||
    record.analysis.title?.trim() ||
    record.fileName;

  const createdAt = new Date().toISOString();
  const day = createdAt.slice(0, 10);

  const alert: DocumentAlert = {
    id: `analysis-ready-${record.id}`,
    kind: "analysis_ready",
    severity: "info",
    priority: "moyenne",
    title: "Analyse complète prête",
    message: `L’analyse juridique de « ${title} » est disponible.`,
    historyId: record.id,
    documentTitle: title,
    fileName: record.fileName,
    evidence: [],
    date: day,
    recommendedAction: "Consulter l’analyse complète",
    createdAt,
    read: false,
    dismissed: false,
  };

  await pinAlert(userId, alert).catch(() => undefined);

  const notification = toAppNotification(alert);
  await dispatchNotifications(userId, [notification], options);
  return notification;
}
