import { query } from "@/lib/db/pool";
import { normalizeBillingPlanId } from "@/config/billing";
import {
  EMPTY_FREE_SUBSCRIPTION,
  type UserSubscriptionRecord,
} from "@/types/billing";

function normalize(record: UserSubscriptionRecord): UserSubscriptionRecord {
  const base = EMPTY_FREE_SUBSCRIPTION(record.userId, record.createdAt);
  return {
    ...base,
    ...record,
    plan: normalizeBillingPlanId(record.plan),
    cancelAtPeriodEnd: Boolean(record.cancelAtPeriodEnd),
  };
}

export async function pgGetUserSubscription(
  userId: string,
): Promise<UserSubscriptionRecord> {
  const result = await query<{ data: UserSubscriptionRecord }>(
    `select data from public.app_subscriptions where user_id = $1`,
    [userId],
  );
  if (!result.rows[0]) return EMPTY_FREE_SUBSCRIPTION(userId);
  return normalize({ ...result.rows[0].data, userId });
}

export async function pgSaveUserSubscription(
  record: UserSubscriptionRecord,
): Promise<UserSubscriptionRecord> {
  const next = normalize({
    ...record,
    updatedAt: new Date().toISOString(),
  });
  await query(
    `insert into public.app_subscriptions (user_id, data, stripe_customer_id, stripe_subscription_id, updated_at)
     values ($1, $2::jsonb, $3, $4, timezone('utc', now()))
     on conflict (user_id) do update set
       data = excluded.data,
       stripe_customer_id = excluded.stripe_customer_id,
       stripe_subscription_id = excluded.stripe_subscription_id,
       updated_at = timezone('utc', now())`,
    [
      next.userId,
      JSON.stringify(next),
      next.stripeCustomerId,
      next.stripeSubscriptionId,
    ],
  );
  return next;
}

export async function pgFindUserIdByStripeCustomerId(
  customerId: string,
): Promise<string | null> {
  const result = await query<{ user_id: string }>(
    `select user_id from public.app_subscriptions
     where stripe_customer_id = $1
     limit 1`,
    [customerId],
  );
  return result.rows[0]?.user_id ?? null;
}
