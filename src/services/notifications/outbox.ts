import { randomUUID } from "crypto";

import { userNotificationOutboxFile } from "@/config/paths";
import { userFileRead, userFileWrite } from "@/lib/user-files";
import type {
  NotificationChannelId,
  NotificationOutboxItem,
} from "@/types/notification";

interface OutboxFile {
  items: NotificationOutboxItem[];
}

async function readOutbox(userId: string): Promise<NotificationOutboxItem[]> {
  try {
    const raw = await userFileRead(userId, userNotificationOutboxFile(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OutboxFile;
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

async function writeOutbox(
  userId: string,
  items: NotificationOutboxItem[],
): Promise<void> {
  await userFileWrite(
    userId,
    userNotificationOutboxFile(userId),
    JSON.stringify({ items } satisfies OutboxFile, null, 2),
  );
}

export async function enqueueNotification(
  userId: string,
  input: Omit<NotificationOutboxItem, "id" | "createdAt" | "status"> & {
    status?: NotificationOutboxItem["status"];
  },
): Promise<NotificationOutboxItem> {
  const items = await readOutbox(userId);
  const duplicate = items.find(
    (item) =>
      item.notificationId === input.notificationId &&
      item.channel === input.channel &&
      item.status === "pending",
  );
  if (duplicate) return duplicate;

  const entry: NotificationOutboxItem = {
    id: randomUUID(),
    userId,
    channel: input.channel,
    notificationId: input.notificationId,
    kind: input.kind,
    payload: input.payload,
    status: input.status ?? "pending",
    createdAt: new Date().toISOString(),
  };

  items.unshift(entry);
  await writeOutbox(userId, items.slice(0, 500));
  return entry;
}

export async function listPendingOutbox(
  userId: string,
  channel?: NotificationChannelId,
): Promise<NotificationOutboxItem[]> {
  const items = await readOutbox(userId);
  return items.filter(
    (item) =>
      item.status === "pending" &&
      (!channel || item.channel === channel),
  );
}

/**
 * Future worker entrypoint: mark pending email items as sent/failed.
 * Currently a no-op processor that leaves items pending for a real SMTP/Resend integration.
 */
export async function processEmailOutbox(
  userId: string,
): Promise<{ pending: number }> {
  const pending = await listPendingOutbox(userId, "email");
  return { pending: pending.length };
}

/** Purge outbox email lié à une analyse supprimée. */
export async function removeOutboxForHistory(
  userId: string,
  historyId: string,
): Promise<void> {
  const items = await readOutbox(userId);
  const next = items.filter((item) => item.payload.historyId !== historyId);
  if (next.length === items.length) return;
  await writeOutbox(userId, next);
}
