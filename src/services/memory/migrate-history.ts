import { listHistoryRecords } from "@/services/history/store";
import { runMemoryDualWrite } from "@/services/memory/dual-write";

/**
 * Backfill graphe mémoire depuis l’historique existant (migration P0).
 * Idempotent — peut être relancé.
 */
export async function migrateUserHistoryToMemory(userId: string): Promise<{
  scanned: number;
  synced: number;
  skipped: number;
  failed: number;
}> {
  const records = await listHistoryRecords(userId);
  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const record of records) {
    const phase = record.analysisPhase ?? "complete";
    if (phase !== "complete") {
      skipped += 1;
      continue;
    }
    try {
      await runMemoryDualWrite(record);
      synced += 1;
    } catch {
      failed += 1;
    }
  }

  return { scanned: records.length, synced, skipped, failed };
}
