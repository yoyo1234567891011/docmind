import { createClient } from "@supabase/supabase-js";

import { usePersistentStorage } from "@/config/persistence";
import { query } from "@/lib/db/pool";
import {
  resolveEffectivePlan,
} from "@/services/billing/access";
import { getUserSubscription } from "@/services/billing/store";
import { syncUserSubscriptionFromStripe } from "@/services/billing/sync";
import { getQuotaStatus } from "@/services/quotas/enforce";
import type { QuotaStatus } from "@/services/quotas/enforce";
import { resetUserUsageMetrics } from "@/services/quotas/store";
import { listRecentJobsForUser } from "@/services/admin/jobs-admin";
import { appendAdminActionLog } from "@/services/admin/ops-status";
import type {
  AdminQuotaMetricSnapshot,
  AdminUserDetail,
  AdminUserListItem,
  AdminUsersListResult,
} from "@/types/admin-ops";
import type { BillingPlanId } from "@/types/billing";

function pickMetric(
  status: QuotaStatus,
  metric: AdminQuotaMetricSnapshot["metric"],
): AdminQuotaMetricSnapshot {
  const item = status.items.find((i) => i.metric === metric);
  return {
    metric,
    used: item?.used ?? 0,
    limit: item?.unlimited ? -1 : (item?.limit ?? 0),
    remaining: item?.unlimited
      ? -1
      : Math.max(0, (item?.limit ?? 0) - (item?.used ?? 0)),
  };
}

async function resolveEmailMap(
  userIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  for (const id of userIds) map.set(id, null);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !service || userIds.length === 0) return map;

  try {
    const admin = createClient(url, service, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // listUsers paginé — indexe par id
    let page = 1;
    const wanted = new Set(userIds);
    let found = 0;
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error) break;
      for (const u of data.users) {
        if (wanted.has(u.id)) {
          map.set(u.id, u.email?.trim().toLowerCase() ?? null);
          found += 1;
        }
      }
      if (found >= wanted.size || data.users.length < 200) break;
      page += 1;
      if (page > 20) break;
    }
  } catch {
    /* emails optionnels */
  }
  return map;
}

async function listKnownUserIds(limit: number): Promise<string[]> {
  if (usePersistentStorage()) {
    try {
      const { rows } = await query<{ user_id: string }>(
        `select user_id from (
           select user_id, max(updated_at) as u from (
             select user_id, updated_at from public.app_subscriptions
             union all
             select user_id, updated_at from public.app_usage
             union all
             select user_id, created_at as updated_at from public.app_analysis_jobs
           ) t
           group by user_id
         ) s
         order by u desc nulls last
         limit $1`,
        [limit],
      );
      return rows.map((r) => r.user_id);
    } catch {
      /* fallthrough */
    }
  }
  // FS : dossiers users
  try {
    const { readdir } = await import("fs/promises");
    const path = await import("path");
    const usersRoot = path.join(process.cwd(), "data", "users");
    const entries = await readdir(usersRoot);
    return entries.filter((e) => !e.startsWith(".")).slice(0, limit);
  } catch {
    return [];
  }
}

async function buildUserItem(
  userId: string,
  email: string | null,
): Promise<AdminUserListItem> {
  const sub = await getUserSubscription(userId);
  const effective = resolveEffectivePlan(sub.plan, sub.status, {
    currentPeriodEnd: sub.currentPeriodEnd,
  });
  const quotas = await getQuotaStatus(userId);
  return {
    userId,
    email,
    planStored: sub.plan,
    planEffective: effective,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    pendingPlan: sub.pendingPlan ?? null,
    pendingPlanEffectiveAt: sub.pendingPlanEffectiveAt ?? null,
    cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
    quotasMonth: quotas.month,
    analyze: pickMetric(quotas, "analyze"),
    search: pickMetric(quotas, "search"),
    letter: pickMetric(quotas, "letter"),
    updatedAt: sub.updatedAt ?? null,
  };
}

export async function listAdminUsers(
  limit = 50,
): Promise<AdminUsersListResult> {
  const ids = await listKnownUserIds(Math.min(Math.max(limit, 1), 200));
  const emails = await resolveEmailMap(ids);
  const users: AdminUserListItem[] = [];
  for (const id of ids) {
    try {
      users.push(await buildUserItem(id, emails.get(id) ?? null));
    } catch {
      /* skip user cassé */
    }
  }
  return {
    at: new Date().toISOString(),
    total: users.length,
    users,
  };
}

async function adminUserExists(userId: string): Promise<boolean> {
  if (usePersistentStorage()) {
    try {
      const { rows } = await query<{ n: string }>(
        `select (
           exists(select 1 from public.app_subscriptions where user_id = $1)
           or exists(select 1 from public.app_usage where user_id = $1)
           or exists(select 1 from public.app_analysis_jobs where user_id = $1)
           or exists(select 1 from public.app_history where user_id = $1)
         )::text as n`,
        [userId],
      );
      if (rows[0]?.n === "true") return true;
    } catch {
      /* ignore */
    }
  }
  const emails = await resolveEmailMap([userId]);
  if (emails.get(userId)) return true;
  try {
    const { readdir } = await import("fs/promises");
    const path = await import("path");
    const usersRoot = path.join(process.cwd(), "data", "users");
    const entries = await readdir(usersRoot);
    if (entries.includes(userId)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export async function getAdminUserDetail(
  userId: string,
): Promise<AdminUserDetail | null> {
  if (!(await adminUserExists(userId))) return null;

  const emails = await resolveEmailMap([userId]);
  try {
    const base = await buildUserItem(userId, emails.get(userId) ?? null);
    const sub = await getUserSubscription(userId);
    const recentJobs = await listRecentJobsForUser(userId, 12);
    return {
      ...base,
      createdAt: sub.createdAt ?? null,
      hasStripeCustomer: Boolean(sub.stripeCustomerId || sub.hasStripeCustomer),
      hasStripeSubscription: Boolean(
        sub.stripeSubscriptionId || sub.hasStripeSubscription,
      ),
      recentJobs,
    };
  } catch {
    return null;
  }
}

export async function adminSyncUserStripe(input: {
  userId: string;
  adminUserId: string;
  adminEmail?: string | null;
}): Promise<AdminUserDetail> {
  await syncUserSubscriptionFromStripe(input.userId);
  const detail = await getAdminUserDetail(input.userId);
  if (!detail) throw new Error("Utilisateur introuvable après sync");
  await appendAdminActionLog({
    action: "sync_stripe",
    adminUserId: input.adminUserId,
    targetUserId: input.userId,
    targetEmail: detail.email,
    ok: true,
    detail: `plan=${detail.planStored} status=${detail.status}`,
  });
  return detail;
}

/**
 * Reset analyze (TEST) — exige confirmation explicite email ou userId.
 * Ne réintroduit PAS de reset auto à l’upgrade.
 */
export async function adminResetAnalyzeQuota(input: {
  userId: string;
  confirm: string;
  adminUserId: string;
}): Promise<AdminUserDetail> {
  const detail = await getAdminUserDetail(input.userId);
  if (!detail) throw new Error("Utilisateur introuvable");

  const confirm = input.confirm.trim().toLowerCase();
  const emailOk =
    detail.email != null && confirm === detail.email.trim().toLowerCase();
  const idOk = confirm === input.userId.toLowerCase();
  if (!emailOk && !idOk) {
    throw new Error(
      "Confirmation invalide : tapez l’email exact ou le userId pour reset analyze.",
    );
  }

  await resetUserUsageMetrics(input.userId, ["analyze"]);
  const after = await getAdminUserDetail(input.userId);
  if (!after) throw new Error("Utilisateur introuvable après reset");

  await appendAdminActionLog({
    action: "reset_analyze_quota",
    adminUserId: input.adminUserId,
    targetUserId: input.userId,
    targetEmail: after.email,
    ok: true,
    detail: `month=${after.quotasMonth} analyze→0 confirm=${confirm.slice(0, 40)}`,
  });
  return after;
}

/** Lookup userId by email (Supabase admin). */
export async function findUserIdByEmail(
  email: string,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !service) return null;
  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const hit = data.users.find(
      (u) => u.email?.trim().toLowerCase() === normalized,
    );
    if (hit?.id) return hit.id;
    if (data.users.length < 200) break;
    page += 1;
    if (page > 30) break;
  }
  return null;
}

export type { BillingPlanId };
