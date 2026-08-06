import { query } from "@/lib/db/pool";

export async function pgGetUserBlob<T>(
  userId: string,
  key: string,
): Promise<T | null> {
  const result = await query<{ data: T }>(
    `select data from public.app_user_blobs where user_id = $1 and key = $2`,
    [userId, key],
  );
  return result.rows[0]?.data ?? null;
}

export async function pgSaveUserBlob(
  userId: string,
  key: string,
  data: unknown,
): Promise<void> {
  await query(
    `insert into public.app_user_blobs (user_id, key, data, updated_at)
     values ($1, $2, $3::jsonb, timezone('utc', now()))
     on conflict (user_id, key) do update set
       data = excluded.data,
       updated_at = timezone('utc', now())`,
    [userId, key, JSON.stringify(data)],
  );
}
