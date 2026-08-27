import { withKeyedLock } from "@/lib/keyed-lock";
import type { HistoryRecord } from "@/types/history";
import { upsertMemoryFromHistoryRecordUnlocked } from "@/services/memory/upsert-from-analysis";

function isAnalysisComplete(record: HistoryRecord): boolean {
  const phase = record.analysisPhase ?? "complete";
  return phase === "complete";
}

async function historyStillExists(
  userId: string,
  historyId: string,
): Promise<boolean> {
  try {
    const { getHistoryRecord } = await import("@/services/history/store");
    await getHistoryRecord(userId, historyId);
    return true;
  } catch {
    return false;
  }
}

async function patchHistoryMemoryMeta(
  record: HistoryRecord,
  meta: Pick<
    HistoryRecord,
    | "relationsPhase"
    | "contentHash"
    | "simhash"
    | "primaryEntityIds"
    | "memorySyncedAt"
  >,
): Promise<void> {
  try {
    // Import dynamique : évite cycle history/store ↔ dual-write
    const { updateHistoryRecord } = await import("@/services/history/store");
    await updateHistoryRecord(record.userId, record.id, meta);
  } catch {
    // history may have been deleted concurrently
  }
}

/**
 * Dual-write async post-history — n’impacte pas la latence P1/P2 API.
 * No-op si preview / failed / history déjà supprimée.
 */
async function runMemoryDualWriteLocked(record: HistoryRecord): Promise<void> {
  // Sérialise les upserts mémoire par user (entities.jsonl RMW).
  await withKeyedLock(`memory:dual:${record.userId}`, async () => {
    if (!(await historyStillExists(record.userId, record.id))) {
      return;
    }
    await patchHistoryMemoryMeta(record, {
      relationsPhase: "pending",
      contentHash: record.contentHash ?? null,
      simhash: record.simhash ?? null,
      primaryEntityIds: record.primaryEntityIds ?? [],
      memorySyncedAt: record.memorySyncedAt ?? null,
    });
    if (!(await historyStillExists(record.userId, record.id))) {
      return;
    }
    const result = await upsertMemoryFromHistoryRecordUnlocked(record);
    if (!(await historyStillExists(record.userId, record.id))) {
      // Course avec delete : retirer ce que l’upsert vient d’écrire.
      const { purgeMemoryForDocument } = await import(
        "@/services/memory/purge-document"
      );
      await purgeMemoryForDocument(record.userId, record.documentId).catch(
        () => undefined,
      );
      return;
    }
    await patchHistoryMemoryMeta(record, {
      relationsPhase: result.document.relationsPhase,
      contentHash: result.document.contentHash ?? null,
      simhash: result.document.simhash ?? null,
      primaryEntityIds: result.document.primaryEntityIds,
      memorySyncedAt: new Date().toISOString(),
    });
  }, { ttlMs: 120_000 });
}

export function scheduleMemoryDualWrite(record: HistoryRecord): void {
  if (!isAnalysisComplete(record)) return;
  // Tests qui indexent via upsertMemoryFromHistoryRecord synchrone.
  if (process.env.DOCMIND_SKIP_MEMORY_DUAL_WRITE === "1") return;

  void (async () => {
    try {
      await runMemoryDualWriteLocked(record);
    } catch {
      if (!(await historyStillExists(record.userId, record.id))) return;
      await patchHistoryMemoryMeta(record, {
        relationsPhase: "failed",
        contentHash: record.contentHash ?? null,
        simhash: record.simhash ?? null,
        primaryEntityIds: record.primaryEntityIds ?? [],
        memorySyncedAt: new Date().toISOString(),
      }).catch(() => undefined);
    }
  })();
}

/** Sync (tests / migration). */
export async function runMemoryDualWrite(
  record: HistoryRecord,
): Promise<void> {
  if (!isAnalysisComplete(record)) return;
  await runMemoryDualWriteLocked(record);
}
