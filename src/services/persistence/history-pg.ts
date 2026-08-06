import { query } from "@/lib/db/pool";
import type { HistoryRecord } from "@/types";

export async function pgGetHistoryRecord(
  userId: string,
  id: string,
): Promise<HistoryRecord | null> {
  const result = await query<{ data: HistoryRecord }>(
    `select data from public.app_history where user_id = $1 and id = $2`,
    [userId, id],
  );
  return result.rows[0]?.data ?? null;
}

export async function pgSaveHistoryRecord(
  record: HistoryRecord,
): Promise<void> {
  await query(
    `insert into public.app_history (id, user_id, document_id, data, updated_at)
     values ($1, $2, $3, $4::jsonb, timezone('utc', now()))
     on conflict (user_id, id) do update set
       document_id = excluded.document_id,
       data = excluded.data,
       updated_at = timezone('utc', now())`,
    [
      record.id,
      record.userId,
      record.documentId,
      JSON.stringify(record),
    ],
  );
}

/**
 * Update only — ne recrée pas une ligne après suppression (anti-résurrection P2).
 * @returns false si la ligne n’existe plus
 */
export async function pgUpdateHistoryRecord(
  record: HistoryRecord,
): Promise<boolean> {
  const result = await query(
    `update public.app_history
     set document_id = $3,
         data = $4::jsonb,
         updated_at = timezone('utc', now())
     where user_id = $1 and id = $2`,
    [
      record.userId,
      record.id,
      record.documentId,
      JSON.stringify(record),
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function pgDeleteHistoryRecord(
  userId: string,
  id: string,
): Promise<boolean> {
  const result = await query(
    `delete from public.app_history where user_id = $1 and id = $2`,
    [userId, id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function pgListHistoryRecords(
  userId: string,
): Promise<HistoryRecord[]> {
  const result = await query<{ data: HistoryRecord }>(
    `select data from public.app_history
     where user_id = $1
     order by updated_at desc`,
    [userId],
  );
  return result.rows.map((row) => row.data);
}

export async function pgUpsertDocumentMeta(input: {
  userId: string;
  documentId: string;
  storageKey: string;
  fileName?: string;
  sizeBytes?: number;
}): Promise<void> {
  await query(
    `insert into public.app_documents (document_id, user_id, storage_key, file_name, size_bytes)
     values ($1, $2, $3, $4, $5)
     on conflict (user_id, document_id) do update set
       storage_key = excluded.storage_key,
       file_name = coalesce(excluded.file_name, public.app_documents.file_name),
       size_bytes = coalesce(excluded.size_bytes, public.app_documents.size_bytes)`,
    [
      input.documentId,
      input.userId,
      input.storageKey,
      input.fileName ?? null,
      input.sizeBytes ?? null,
    ],
  );
}
