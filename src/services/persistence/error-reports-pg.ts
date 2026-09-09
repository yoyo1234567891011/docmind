import { query } from "@/lib/db/pool";
import type { ErrorReportEntry } from "@/types/beta";

export async function pgInsertErrorReport(
  entry: ErrorReportEntry,
): Promise<void> {
  await query(
    `insert into public.app_error_reports (id, at, user_id, data)
     values ($1, $2::timestamptz, $3, $4::jsonb)
     on conflict (id) do nothing`,
    [entry.id, entry.at, entry.userId, JSON.stringify(entry)],
  );
}

export async function pgListErrorReports(
  limit: number,
): Promise<ErrorReportEntry[]> {
  const capped = Math.min(Math.max(limit, 1), 500);
  const result = await query<{ data: ErrorReportEntry }>(
    `select data from public.app_error_reports
     order by at desc
     limit $1`,
    [capped],
  );
  return result.rows.map((row) => row.data);
}

export async function pgAnonymizeErrorReportsForUser(
  userId: string,
): Promise<number> {
  const result = await query(
    `update public.app_error_reports
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
