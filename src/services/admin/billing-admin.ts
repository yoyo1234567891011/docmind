import { BILLING_PLANS, isPaidBillingPlanId } from "@/config/billing";
import { usePersistentStorage } from "@/config/persistence";
import { query } from "@/lib/db/pool";
import {
  getStripeSecretKey,
  getStripeWebhookSecret,
  isStripeLiveMode,
} from "@/lib/stripe/env";
import { resolveEffectivePlan } from "@/services/billing/access";
import { getUserSubscription } from "@/services/billing/store";
import type { AdminBillingDetail } from "@/types/admin-ops";
import type {
  BillingPlanId,
  UserSubscriptionRecord,
} from "@/types/billing";

async function listSubs(): Promise<{
  subs: UserSubscriptionRecord[];
  source: AdminBillingDetail["source"];
}> {
  try {
    if (usePersistentStorage()) {
      const result = await query<{
        data: UserSubscriptionRecord;
        user_id: string;
      }>(`select user_id, data from public.app_subscriptions`);
      return {
        source: "postgres",
        subs: result.rows.map((row) => ({
          ...row.data,
          userId: row.user_id,
        })),
      };
    }
  } catch {
    /* fallthrough */
  }
  try {
    const { readdir } = await import("fs/promises");
    const path = await import("path");
    const usersRoot = path.join(process.cwd(), "data", "users");
    const entries = await readdir(usersRoot);
    const subs: UserSubscriptionRecord[] = [];
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      try {
        subs.push(await getUserSubscription(entry));
      } catch {
        /* ignore */
      }
    }
    return { source: subs.length ? "filesystem" : "none", subs };
  } catch {
    return { source: "none", subs: [] };
  }
}

function stripeMode(): AdminBillingDetail["stripeMode"] {
  if (!getStripeSecretKey()) return "unconfigured";
  return isStripeLiveMode() ? "live" : "test";
}

/** Détail billing admin : par plan, past_due, cancel, mode Test/Live. */
export async function collectAdminBillingDetail(): Promise<AdminBillingDetail> {
  const { subs, source } = await listSubs();
  const planIds = Object.keys(BILLING_PLANS) as BillingPlanId[];
  const byPlanMap = new Map<BillingPlanId, { count: number; pastDue: number }>();
  for (const id of planIds) {
    byPlanMap.set(id, { count: 0, pastDue: 0 });
  }

  let pastDue = 0;
  let cancelAtPeriodEnd = 0;
  let paidActiveEffective = 0;
  let freeEffective = 0;
  let mrrEur = 0;

  for (const sub of subs) {
    const stored = byPlanMap.get(sub.plan) ?? { count: 0, pastDue: 0 };
    stored.count += 1;
    if (sub.status === "past_due") {
      stored.pastDue += 1;
      pastDue += 1;
    }
    byPlanMap.set(sub.plan, stored);

    if (sub.cancelAtPeriodEnd) cancelAtPeriodEnd += 1;

    const effective = resolveEffectivePlan(sub.plan, sub.status, {
      currentPeriodEnd: sub.currentPeriodEnd,
    });
    if (isPaidBillingPlanId(effective)) {
      paidActiveEffective += 1;
      mrrEur += BILLING_PLANS[effective].priceMonthlyEur ?? 0;
    } else {
      freeEffective += 1;
    }
  }

  const byPlan = planIds.map((plan) => {
    const row = byPlanMap.get(plan)!;
    return {
      plan,
      count: row.count,
      effectiveFreeWhilePastDue: row.pastDue,
    };
  });

  return {
    at: new Date().toISOString(),
    stripeMode: stripeMode(),
    webhookConfigured: Boolean(getStripeWebhookSecret()),
    source,
    byPlan,
    pastDue,
    cancelAtPeriodEnd,
    paidActiveEffective,
    freeEffective,
    mrrEur: Math.round(mrrEur * 100) / 100,
  };
}
