import type { QuotaMetric } from "@/config/quotas";
import { query } from "@/lib/db/pool";
import type { UserUsageMonth } from "@/services/quotas/store";

export async function pgGetUserUsage(
  userId: string,
  month: string,
): Promise<UserUsageMonth | null> {
  const result = await query<{ data: UserUsageMonth }>(
    `select data from public.app_usage where user_id = $1 and month = $2`,
    [userId, month],
  );
  return result.rows[0]?.data ?? null;
}

export async function pgSaveUserUsage(
  userId: string,
  usage: UserUsageMonth,
): Promise<void> {
  await query(
    `insert into public.app_usage (user_id, month, data, updated_at)
     values ($1, $2, $3::jsonb, timezone('utc', now()))
     on conflict (user_id, month) do update set
       data = excluded.data,
       updated_at = timezone('utc', now())`,
    [userId, usage.month, JSON.stringify(usage)],
  );
}

/**
 * Incrément atomique JSONB.
 * Si `limit >= 0` et used >= limit → `null` (pas d’incrément).
 */
export async function pgIncrementUserUsage(
  userId: string,
  month: string,
  metric: QuotaMetric,
  by: number,
  empty: UserUsageMonth,
  limit = -1,
): Promise<UserUsageMonth | null> {
  await query(
    `insert into public.app_usage (user_id, month, data, updated_at)
     values ($1, $2, $3::jsonb, timezone('utc', now()))
     on conflict (user_id, month) do nothing`,
    [userId, month, JSON.stringify(empty)],
  );

  if (limit >= 0) {
    const updated = await query<{ data: UserUsageMonth }>(
      `update public.app_usage
       set data = jsonb_set(
             jsonb_set(
               data,
               array[$3]::text[],
               to_jsonb(coalesce((data->>$3)::int, 0) + $4::int),
               true
             ),
             '{updatedAt}',
             to_jsonb(timezone('utc', now())::text),
             true
           ),
           updated_at = timezone('utc', now())
       where user_id = $1 and month = $2
         and coalesce((data->>$3)::int, 0) < $5::int
       returning data`,
      [userId, month, metric, by, limit],
    );
    return updated.rows[0]?.data ?? null;
  }

  const updated = await query<{ data: UserUsageMonth }>(
    `update public.app_usage
     set data = jsonb_set(
           jsonb_set(
             data,
             array[$3]::text[],
             to_jsonb(coalesce((data->>$3)::int, 0) + $4::int),
             true
           ),
           '{updatedAt}',
           to_jsonb(timezone('utc', now())::text),
           true
         ),
         updated_at = timezone('utc', now())
     where user_id = $1 and month = $2
     returning data`,
    [userId, month, metric, by],
  );
  return updated.rows[0]?.data ?? null;
}

/** Décrémente sans passer sous 0 (remboursement après échec). */
export async function pgDecrementUserUsage(
  userId: string,
  month: string,
  metric: QuotaMetric,
  by = 1,
): Promise<UserUsageMonth | null> {
  const updated = await query<{ data: UserUsageMonth }>(
    `update public.app_usage
     set data = jsonb_set(
           jsonb_set(
             data,
             array[$3]::text[],
             to_jsonb(greatest(0, coalesce((data->>$3)::int, 0) - $4::int)),
             true
           ),
           '{updatedAt}',
           to_jsonb(timezone('utc', now())::text),
           true
         ),
         updated_at = timezone('utc', now())
     where user_id = $1 and month = $2
     returning data`,
    [userId, month, metric, by],
  );
  return updated.rows[0]?.data ?? null;
}
