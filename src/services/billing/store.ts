import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { usePersistentStorage } from "@/config/persistence";
import { userSubscriptionFile } from "@/config/paths";
import { withKeyedLock } from "@/lib/keyed-lock";
import {
  pgFindUserIdByStripeCustomerId,
  pgGetUserSubscription,
  pgSaveUserSubscription,
} from "@/services/persistence/subscriptions-pg";
import { normalizeBillingPlanId } from "@/config/billing";
import {
  EMPTY_FREE_SUBSCRIPTION,
  type BillingSubscriptionStatus,
  type UserSubscriptionRecord,
} from "@/types/billing";

async function ensureFile(userId: string): Promise<string> {
  const filePath = userSubscriptionFile(userId);
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeFile(
      filePath,
      JSON.stringify(EMPTY_FREE_SUBSCRIPTION(userId), null, 2),
      "utf8",
    );
  }
  return filePath;
}

function normalize(record: UserSubscriptionRecord): UserSubscriptionRecord {
  const plan = normalizeBillingPlanId(record.plan);
  const base = EMPTY_FREE_SUBSCRIPTION(record.userId, record.createdAt);
  return {
    ...base,
    ...record,
    plan,
    status: (record.status || "active") as BillingSubscriptionStatus,
    cancelAtPeriodEnd: Boolean(record.cancelAtPeriodEnd),
    stripeCustomerId: record.stripeCustomerId ?? null,
    stripeSubscriptionId: record.stripeSubscriptionId ?? null,
    stripePriceId: record.stripePriceId ?? null,
    currentPeriodStart: record.currentPeriodStart ?? null,
    currentPeriodEnd: record.currentPeriodEnd ?? null,
    canceledAt: record.canceledAt ?? null,
    lastWebhookEventId: record.lastWebhookEventId ?? null,
    lastWebhookEventType: record.lastWebhookEventType ?? null,
    lastWebhookAt: record.lastWebhookAt ?? null,
  };
}

export async function getUserSubscription(
  userId: string,
): Promise<UserSubscriptionRecord> {
  if (usePersistentStorage()) {
    return pgGetUserSubscription(userId);
  }
  const filePath = await ensureFile(userId);
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as UserSubscriptionRecord;
    return normalize({ ...parsed, userId });
  } catch {
    return EMPTY_FREE_SUBSCRIPTION(userId);
  }
}

export async function saveUserSubscription(
  record: UserSubscriptionRecord,
): Promise<UserSubscriptionRecord> {
  const next = normalize({
    ...record,
    updatedAt: new Date().toISOString(),
  });
  if (usePersistentStorage()) {
    return pgSaveUserSubscription(next);
  }
  const filePath = await ensureFile(record.userId);
  await writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

/**
 * Patch abonnement sous mutex user — évite lost-update
 * (refund ↔ renewal / webhook ↔ sync).
 *
 * `webhookCreatedSec` : si fourni, ignore le patch si un événement plus récent
 * a déjà été appliqué (relecture sous le même verrou — anti hors-ordre concurrent).
 * Retourne `null` si l’événement est stale (ignoré).
 */
export async function upsertSubscriptionPatch(
  userId: string,
  patch: Partial<Omit<UserSubscriptionRecord, "userId" | "createdAt">>,
  options?: { webhookCreatedSec?: number },
): Promise<UserSubscriptionRecord | null> {
  return withKeyedLock(`billing:sub:${userId}`, async () => {
    const current = await getUserSubscription(userId);
    if (
      options?.webhookCreatedSec != null &&
      current.lastWebhookAt
    ) {
      const prevMs = Date.parse(current.lastWebhookAt);
      const eventMs = options.webhookCreatedSec * 1000;
      if (!Number.isNaN(prevMs) && eventMs < prevMs) {
        return null;
      }
    }
    return saveUserSubscription({
      ...current,
      ...patch,
      userId,
      createdAt: current.createdAt,
    });
  });
}

export async function findUserIdByStripeCustomerId(
  customerId: string,
): Promise<string | null> {
  if (usePersistentStorage()) {
    return pgFindUserIdByStripeCustomerId(customerId);
  }
  const { readdir } = await import("fs/promises");
  const usersRoot = path.join(process.cwd(), "data", "users");
  let entries: string[] = [];
  try {
    entries = await readdir(usersRoot);
  } catch {
    return null;
  }

  for (const entry of entries) {
    try {
      const sub = await getUserSubscription(entry);
      if (sub.stripeCustomerId === customerId) return entry;
    } catch {
      /* ignore */
    }
  }
  return null;
}
