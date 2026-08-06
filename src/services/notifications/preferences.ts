import { userNotificationPreferencesFile } from "@/config/paths";
import { userFileRead, userFileWrite } from "@/lib/user-files";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationKind,
  type NotificationPreferences,
} from "@/types/notification";

function defaultPreferences(): NotificationPreferences {
  return {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    kinds: { ...DEFAULT_NOTIFICATION_PREFERENCES.kinds },
    updatedAt: new Date().toISOString(),
  };
}

function normalize(
  parsed: Partial<NotificationPreferences>,
): NotificationPreferences {
  const base = defaultPreferences();
  return {
    inAppEnabled: parsed.inAppEnabled ?? base.inAppEnabled,
    emailEnabled: parsed.emailEnabled ?? base.emailEnabled,
    emailAddress: parsed.emailAddress ?? base.emailAddress,
    kinds: { ...base.kinds, ...(parsed.kinds ?? {}) },
    updatedAt: parsed.updatedAt ?? base.updatedAt,
  };
}

export async function readNotificationPreferences(
  userId: string,
): Promise<NotificationPreferences> {
  try {
    const raw = await userFileRead(
      userId,
      userNotificationPreferencesFile(userId),
    );
    if (!raw) return defaultPreferences();
    return normalize(JSON.parse(raw) as Partial<NotificationPreferences>);
  } catch {
    return defaultPreferences();
  }
}

export async function updateNotificationPreferences(
  userId: string,
  patch: {
    inAppEnabled?: boolean;
    emailEnabled?: boolean;
    emailAddress?: string | null;
    kinds?: Partial<Record<NotificationKind, boolean>>;
  },
): Promise<NotificationPreferences> {
  const current = await readNotificationPreferences(userId);
  const next: NotificationPreferences = {
    inAppEnabled: patch.inAppEnabled ?? current.inAppEnabled,
    emailEnabled: patch.emailEnabled ?? current.emailEnabled,
    emailAddress:
      patch.emailAddress !== undefined
        ? patch.emailAddress?.trim() || null
        : current.emailAddress,
    kinds: {
      ...current.kinds,
      ...(patch.kinds ?? {}),
    },
    updatedAt: new Date().toISOString(),
  };

  await userFileWrite(
    userId,
    userNotificationPreferencesFile(userId),
    JSON.stringify(next, null, 2),
  );
  return next;
}

export function isKindEnabled(
  prefs: NotificationPreferences,
  kind: NotificationKind,
): boolean {
  return prefs.kinds[kind] !== false;
}
