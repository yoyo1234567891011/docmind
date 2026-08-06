import { buildEmailContent } from "@/services/notifications/channels/email";
import { enqueueNotification } from "@/services/notifications/outbox";
import {
  isKindEnabled,
  readNotificationPreferences,
} from "@/services/notifications/preferences";
import type { AppNotification } from "@/types/notification";

export interface DispatchResult {
  inApp: boolean;
  emailQueued: boolean;
}

/**
 * Route a notification to enabled channels.
 * - in_app: handled by live alerts list (always "delivered" if enabled)
 * - email: enqueued to outbox for a future worker / provider
 */
export async function dispatchNotification(
  userId: string,
  notification: AppNotification,
  options?: { userEmail?: string | null },
): Promise<DispatchResult> {
  const prefs = await readNotificationPreferences(userId);
  const result: DispatchResult = { inApp: false, emailQueued: false };

  if (!isKindEnabled(prefs, notification.kind)) {
    return result;
  }

  if (prefs.inAppEnabled && notification.channels.includes("in_app")) {
    result.inApp = true;
  }

  if (prefs.emailEnabled && notification.channels.includes("email")) {
    const to = prefs.emailAddress || options?.userEmail || null;
    if (to) {
      const { subject, body } = buildEmailContent(notification);
      await enqueueNotification(userId, {
        userId,
        channel: "email",
        notificationId: notification.id,
        kind: notification.kind,
        payload: {
          to,
          subject,
          body,
          historyId: notification.historyId,
        },
        status: "pending",
      });
      result.emailQueued = true;
    }
  }

  return result;
}

export async function dispatchNotifications(
  userId: string,
  notifications: AppNotification[],
  options?: { userEmail?: string | null },
): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [];
  for (const notification of notifications) {
    results.push(await dispatchNotification(userId, notification, options));
  }
  return results;
}
