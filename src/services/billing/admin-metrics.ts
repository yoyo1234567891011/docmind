import { readdir } from "fs/promises";
import path from "path";

import { usePersistentStorage } from "@/config/persistence";
import { BILLING_PLANS } from "@/config/billing";
import { query } from "@/lib/db/pool";
import { getUserSubscription } from "@/services/billing/store";
import type { UserSubscriptionRecord } from "@/types/billing";

export interface BillingAdminRollup {
  premiumActive: number;
  premiumCanceling: number;
  freeLocal: number;
  mrrEur: number;
  priceMonthlyEur: number;
  source: "postgres" | "filesystem" | "none";
}

function isPremiumActive(sub: UserSubscriptionRecord): boolean {
  if (sub.plan !== "premium") return false;
  return (
    sub.status === "active" ||
    sub.status === "trialing" ||
    sub.status === "past_due"
  );
}

async function listFromPostgres(): Promise<UserSubscriptionRecord[]> {
  const result = await query<{ data: UserSubscriptionRecord; user_id: string }>(
    `select user_id, data from public.app_subscriptions`,
  );
  return result.rows.map((row) => ({
    ...row.data,
    userId: row.user_id,
  }));
}

async function listFromFilesystem(): Promise<UserSubscriptionRecord[]> {
  const usersRoot = path.join(process.cwd(), "data", "users");
  let entries: string[] = [];
  try {
    entries = await readdir(usersRoot);
  } catch {
    return [];
  }
  const out: UserSubscriptionRecord[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    try {
      out.push(await getUserSubscription(entry));
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Agrégats abonnements pour MRR / Premium actifs. */
export async function collectBillingAdminRollup(): Promise<BillingAdminRollup> {
  const priceMonthlyEur = BILLING_PLANS.premium.priceMonthlyEur ?? 10;
  let subs: UserSubscriptionRecord[] = [];
  let source: BillingAdminRollup["source"] = "none";

  try {
    if (usePersistentStorage()) {
      subs = await listFromPostgres();
      source = "postgres";
    } else {
      subs = await listFromFilesystem();
      source = "filesystem";
    }
  } catch {
    try {
      subs = await listFromFilesystem();
      source = subs.length > 0 ? "filesystem" : "none";
    } catch {
      return {
        premiumActive: 0,
        premiumCanceling: 0,
        freeLocal: 0,
        mrrEur: 0,
        priceMonthlyEur,
        source: "none",
      };
    }
  }

  let premiumActive = 0;
  let premiumCanceling = 0;
  let freeLocal = 0;
  for (const sub of subs) {
    if (isPremiumActive(sub)) {
      premiumActive += 1;
      if (sub.cancelAtPeriodEnd) premiumCanceling += 1;
    } else {
      freeLocal += 1;
    }
  }

  return {
    premiumActive,
    premiumCanceling,
    freeLocal,
    mrrEur: Math.round(premiumActive * priceMonthlyEur * 100) / 100,
    priceMonthlyEur,
    source,
  };
}
