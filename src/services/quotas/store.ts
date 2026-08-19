import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import type { QuotaMetric } from "@/config/quotas";
import { usePersistentStorage } from "@/config/persistence";
import { userDataDir } from "@/config/paths";
import { withKeyedLock } from "@/lib/keyed-lock";
import {
  pgDecrementUserUsage,
  pgGetUserUsage,
  pgIncrementUserUsage,
} from "@/services/persistence/usage-pg";

export interface UserUsageMonth {
  month: string; // YYYY-MM
  analyze: number;
  upload: number;
  letter: number;
  search: number;
  updatedAt: string;
}

function usageFile(userId: string): string {
  return path.join(userDataDir(userId), "usage.json");
}

export function currentUsageMonth(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function emptyMonth(month: string): UserUsageMonth {
  return {
    month,
    analyze: 0,
    upload: 0,
    letter: 0,
    search: 0,
    updatedAt: new Date().toISOString(),
  };
}

export async function getUserUsage(userId: string): Promise<UserUsageMonth> {
  const month = currentUsageMonth();
  if (usePersistentStorage()) {
    const data = await pgGetUserUsage(userId, month);
    if (!data || data.month !== month) return emptyMonth(month);
    return { ...emptyMonth(month), ...data, month };
  }
  try {
    const raw = await readFile(usageFile(userId), "utf8");
    const parsed = JSON.parse(raw) as UserUsageMonth;
    if (parsed.month !== month) return emptyMonth(month);
    return {
      ...emptyMonth(month),
      ...parsed,
      month,
    };
  } catch {
    return emptyMonth(month);
  }
}

/**
 * Incrémente le quota. Si `limit >= 0` et plafond atteint → `null`.
 */
export async function incrementUserUsage(
  userId: string,
  metric: QuotaMetric,
  by = 1,
  limit = -1,
): Promise<UserUsageMonth | null> {
  const month = currentUsageMonth();
  if (usePersistentStorage()) {
    return pgIncrementUserUsage(
      userId,
      month,
      metric,
      by,
      emptyMonth(month),
      limit,
    );
  }

  return withKeyedLock(`quota:${userId}:${month}`, async () => {
    const current = await getUserUsage(userId);
    const used = current[metric] ?? 0;
    if (limit >= 0 && used >= limit) return null;
    const next: UserUsageMonth = {
      ...current,
      [metric]: used + by,
      updatedAt: new Date().toISOString(),
    };
    await mkdir(path.dirname(usageFile(userId)), { recursive: true });
    await writeFile(usageFile(userId), JSON.stringify(next, null, 2), "utf8");
    return next;
  });
}

/** Rembourse N unités (plancher 0). */
export async function decrementUserUsage(
  userId: string,
  metric: QuotaMetric,
  by = 1,
): Promise<UserUsageMonth | null> {
  const month = currentUsageMonth();
  if (usePersistentStorage()) {
    return pgDecrementUserUsage(userId, month, metric, by);
  }

  return withKeyedLock(`quota:${userId}:${month}`, async () => {
    const current = await getUserUsage(userId);
    const used = current[metric] ?? 0;
    const next: UserUsageMonth = {
      ...current,
      [metric]: Math.max(0, used - by),
      updatedAt: new Date().toISOString(),
    };
    await mkdir(path.dirname(usageFile(userId)), { recursive: true });
    await writeFile(usageFile(userId), JSON.stringify(next, null, 2), "utf8");
    return next;
  });
}
