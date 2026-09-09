import { query } from "@/lib/db/pool";
import type { FeedbackEntry } from "@/types/beta";

export async function pgInsertFeedback(entry: FeedbackEntry): Promise<void> {
  await query(
    `insert into public.app_feedback (id, at, user_id, data)
     values ($1, $2::timestamptz, $3, $4::jsonb)
     on conflict (id) do nothing`,
    [entry.id, entry.at, entry.userId, JSON.stringify(entry)],
  );
}

export async function pgListFeedback(limit: number): Promise<FeedbackEntry[]> {
  const capped = Math.min(Math.max(limit, 1), 500);
  const result = await query<{ data: FeedbackEntry }>(
    `select data from public.app_feedback
     order by at desc
     limit $1`,
    [capped],
  );
  return result.rows.map((row) => row.data);
}

export async function pgAnonymizeFeedbackForUser(
  userId: string,
): Promise<number> {
  const result = await query(
    `update public.app_feedback
     set user_id = null,
         data = jsonb_set(
           jsonb_set(data, '{userId}', 'null'::jsonb, true),
           '{email}', 'null'::jsonb, true
         )
     where user_id = $1`,
    [userId],
  );
  return result.rowCount ?? 0;
}
