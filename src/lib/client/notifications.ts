import type {
  ApiResponse,
  NotificationPreferences,
} from "@/types";

export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  const response = await fetch("/api/notifications/preferences", {
    cache: "no-store",
  });
  const payload = (await response.json()) as ApiResponse<{
    preferences: NotificationPreferences;
  }>;
  if (!payload.success) throw new Error(payload.error.message);
  return payload.data.preferences;
}

export async function patchNotificationPreferences(
  patch: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  const response = await fetch("/api/notifications/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const payload = (await response.json()) as ApiResponse<{
    preferences: NotificationPreferences;
  }>;
  if (!payload.success) throw new Error(payload.error.message);
  return payload.data.preferences;
}
