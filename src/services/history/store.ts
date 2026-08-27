import { mkdir, readFile, unlink, writeFile, readdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

import { usePersistentStorage } from "@/config/persistence";
import {
  assertSafeResourceId,
  userHistoryDir,
  userHistoryRecordPath,
  userPdfPath,
} from "@/config/paths";
import { assertOwnedByUser } from "@/lib/auth/ownership";
import { chaosGate } from "@/lib/chaos";
import { AppError } from "@/lib/errors";
import { deletePdfObject } from "@/lib/storage/s3";
import {
  pgDeleteHistoryRecord,
  pgGetHistoryRecord,
  pgListHistoryRecords,
  pgSaveHistoryRecord,
  pgUpdateHistoryRecord,
} from "@/services/persistence/history-pg";
import { resolveFolderIdForClassification } from "@/services/folders/auto-file";
import { normalizeStoredFolderId } from "@/types";
import {
  EMPTY_READY_REPLY,
  type HistoryRecord,
  type PatchHistoryInput,
  type SaveHistoryInput,
} from "@/types";
import {
  buildDocumentSheet,
  indexDocumentSheet,
  removeSearchIndexEntry,
} from "@/services/sheets";
import { scheduleMemoryDualWrite } from "@/services/memory/dual-write";
import { purgeMemoryForDocument } from "@/services/memory/purge-document";

function resolveAutoFolderId(record: Pick<
  HistoryRecord,
  "classification" | "analysis"
>): string | null {
  return resolveFolderIdForClassification({
    category: record.classification.category,
    documentType: record.analysis.document_type,
    categoryLabel: record.classification.label,
  });
}

async function ensureHistoryDir(userId: string): Promise<string> {
  const dir = userHistoryDir(userId);
  await mkdir(dir, { recursive: true });
  return dir;
}

function getRecordPath(userId: string, id: string): string {
  return userHistoryRecordPath(userId, id);
}

async function persistHistoryRecord(record: HistoryRecord): Promise<void> {
  await chaosGate("memory_saturated");
  await chaosGate("disk_full");
  if (usePersistentStorage()) {
    await pgSaveHistoryRecord(record);
    return;
  }
  await ensureHistoryDir(record.userId);
  await writeFile(
    getRecordPath(record.userId, record.id),
    JSON.stringify(record, null, 2),
    "utf8",
  );
}

/** Persist update — refuse de ressusciter un historique supprimé. */
async function persistHistoryRecordUpdate(
  record: HistoryRecord,
): Promise<boolean> {
  await chaosGate("memory_saturated");
  await chaosGate("disk_full");
  if (usePersistentStorage()) {
    return pgUpdateHistoryRecord(record);
  }
  const filePath = getRecordPath(record.userId, record.id);
  try {
    await readFile(filePath, "utf8");
  } catch {
    return false;
  }
  await writeFile(filePath, JSON.stringify(record, null, 2), "utf8");
  return true;
}

export async function saveHistoryRecord(
  userId: string,
  input: SaveHistoryInput,
): Promise<HistoryRecord> {
  try {
    await ensureHistoryDir(userId);

    const explicitFolder =
      input.folderId !== undefined
        ? normalizeStoredFolderId(input.folderId)
        : undefined;
    const autoFolder = resolveFolderIdForClassification({
      category: input.result.classification.category,
      documentType: input.result.analysis.document_type,
      categoryLabel: input.result.classification.label,
    });

    const draft: HistoryRecord = {
      id: randomUUID(),
      userId,
      documentId: input.result.documentId,
      fileName: input.fileName || "document.pdf",
      displayName: null,
      favorite: false,
      tagIds: [],
      createdAt: new Date().toISOString(),
      classification: input.result.classification,
      analysis: input.result.analysis,
      readyReply: input.result.readyReply ?? EMPTY_READY_REPLY,
      model: input.result.model,
      analyzedAt: input.result.analyzedAt,
      extractedText: input.extractedText,
      folderId:
        explicitFolder !== undefined ? explicitFolder : autoFolder,
      folderSource: explicitFolder !== undefined ? "manual" : "auto",
      promptsUsed: input.result.promptsUsed,
      analysisPhase: input.result.phase ?? "complete",
    };

    const sheet = input.result.sheet
      ? {
          ...input.result.sheet,
          historyId: draft.id,
          documentId: draft.documentId,
          fileName: draft.fileName,
          analyzedAt: draft.analyzedAt,
          createdAt: draft.createdAt,
          updatedAt: new Date().toISOString(),
        }
      : buildDocumentSheet(draft);

    const record: HistoryRecord = {
      ...draft,
      sheet,
    };

    await persistHistoryRecord(record);

    // Index async — ne bloque pas le retour API (embeddings Ollama)
    void indexDocumentSheet(userId, record).catch(() => undefined);
    // Dual-write graphe mémoire (P0) — async, sans bloquer P1/P2
    scheduleMemoryDualWrite(record);

    return record;
  } catch (error) {
    if (error instanceof AppError) throw error;

    throw new AppError(
      "INTERNAL_ERROR",
      "Impossible d'enregistrer l'analyse dans l'historique.",
      500,
    );
  }
}

function normalizeHistoryRecord(
  userId: string,
  record: HistoryRecord,
): HistoryRecord {
  // Isolation stricte : un enregistrement d’un autre user ne doit jamais fuiter
  if (record.userId && record.userId !== userId) {
    assertOwnedByUser(record.userId, userId, "analyse");
  }

  return {
    ...record,
    userId,
    displayName: record.displayName ?? null,
    favorite: Boolean(record.favorite),
    tagIds: Array.isArray(record.tagIds) ? record.tagIds : [],
    readyReply: record.readyReply ?? EMPTY_READY_REPLY,
    folderId: normalizeStoredFolderId(record.folderId),
    folderSource: record.folderSource === "manual" ? "manual" : record.folderSource === "auto" ? "auto" : undefined,
  };
}

function shouldAutoFile(record: HistoryRecord): boolean {
  if (record.folderSource === "manual") return false;
  return !record.folderId;
}

async function applyAutoFolderIfNeeded(
  userId: string,
  record: HistoryRecord,
): Promise<HistoryRecord> {
  if (!shouldAutoFile(record)) return record;

  const folderId = resolveAutoFolderId(record);
  if (!folderId) return record;

  const updated: HistoryRecord = {
    ...record,
    folderId,
    folderSource: "auto",
  };
  const ok = await persistHistoryRecordUpdate(updated);
  return ok ? updated : record;
}

export async function getHistoryRecord(
  userId: string,
  id: string,
): Promise<HistoryRecord> {
  try {
    let parsed: HistoryRecord | null = null;
    if (usePersistentStorage()) {
      parsed = await pgGetHistoryRecord(userId, id);
    } else {
      const content = await readFile(getRecordPath(userId, id), "utf8");
      parsed = JSON.parse(content) as HistoryRecord;
    }
    if (!parsed) {
      throw new AppError(
        "NOT_FOUND",
        "Analyse introuvable dans l'historique.",
        404,
      );
    }
    const record = normalizeHistoryRecord(userId, parsed);

    let next = record;
    let dirty = false;

    if (!next.sheet) {
      next = {
        ...next,
        sheet: buildDocumentSheet(next),
      };
      dirty = true;
    }

    const filed = await applyAutoFolderIfNeeded(userId, next);
    if (filed !== next) {
      next = filed;
      dirty = true;
    }

    if (dirty) {
      const ok = await persistHistoryRecordUpdate(next);
      if (ok && !record.sheet && next.sheet) {
        await indexDocumentSheet(userId, next).catch(() => undefined);
      }
      if (!ok) return record;
    }

    return next;
  } catch (error) {
    if (error instanceof AppError) throw error;

    throw new AppError(
      "NOT_FOUND",
      "Analyse introuvable dans l'historique.",
      404,
    );
  }
}

export async function listHistoryRecords(
  userId: string,
): Promise<HistoryRecord[]> {
  try {
    if (usePersistentStorage()) {
      const rows = await pgListHistoryRecords(userId);
      const records = (
        await Promise.all(
          rows.map(async (parsed) => {
            if (parsed.userId && parsed.userId !== userId) return null;
            const normalized = normalizeHistoryRecord(userId, parsed);
            return applyAutoFolderIfNeeded(userId, normalized);
          }),
        )
      ).filter((record): record is HistoryRecord => Boolean(record));
      return records.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    }

    const dir = await ensureHistoryDir(userId);
    const files = await readdir(dir);
    const jsonFiles = files.filter((file) => file.endsWith(".json"));

    const records = (
      await Promise.all(
        jsonFiles.map(async (file) => {
          try {
            const content = await readFile(path.join(dir, file), "utf8");
            const parsed = JSON.parse(content) as HistoryRecord;
            if (parsed.userId && parsed.userId !== userId) return null;
            const normalized = normalizeHistoryRecord(userId, parsed);
            return applyAutoFolderIfNeeded(userId, normalized);
          } catch {
            return null;
          }
        }),
      )
    ).filter((record): record is HistoryRecord => Boolean(record));

    return records.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  } catch (error) {
    if (error instanceof AppError) throw error;

    throw new AppError(
      "INTERNAL_ERROR",
      "Impossible de lire l'historique des analyses.",
      500,
    );
  }
}

function logCascadeError(
  userId: string,
  documentId: string | null,
  historyId: string,
  operation: string,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[history-delete] userId=${userId} documentId=${documentId ?? "none"} historyId=${historyId} operation=${operation} error=${message.slice(0, 300)}`,
  );
}

async function runSecondaryCleanup(
  userId: string,
  historyId: string,
  documentId: string | null,
  operation: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    logCascadeError(userId, documentId, historyId, operation, error);
  }
}

export async function deleteHistoryRecord(
  userId: string,
  id: string,
): Promise<void> {
  // Identification fiable avant toute suppression.
  const record = await getHistoryRecord(userId, id);
  const documentId = record.documentId?.trim() || null;

  if (usePersistentStorage()) {
    const deleted = await pgDeleteHistoryRecord(userId, id);
    if (!deleted) {
      throw new AppError(
        "NOT_FOUND",
        "Analyse introuvable dans l'historique.",
        404,
      );
    }
  } else {
    try {
      await unlink(getRecordPath(userId, id));
    } catch {
      throw new AppError(
        "NOT_FOUND",
        "Analyse introuvable dans l'historique.",
        404,
      );
    }
  }

  // Nettoyages secondaires — loggés, non bloquants.
  await runSecondaryCleanup(userId, id, documentId, "search_index", () =>
    removeSearchIndexEntry(userId, id),
  );

  await runSecondaryCleanup(userId, id, documentId, "alerts", async () => {
    const { removeAlertsLinkedToHistory } = await import(
      "@/services/alerts/state"
    );
    await removeAlertsLinkedToHistory(userId, id);
  });

  await runSecondaryCleanup(userId, id, documentId, "outbox", async () => {
    const { removeOutboxForHistory } = await import(
      "@/services/notifications/outbox"
    );
    await removeOutboxForHistory(userId, id);
  });

  await runSecondaryCleanup(userId, id, documentId, "analysis_jobs", async () => {
    const { deleteAnalysisJobsForHistory } = await import(
      "@/services/analysis-jobs/store"
    );
    await deleteAnalysisJobsForHistory(userId, id);
  });

  await runSecondaryCleanup(userId, id, documentId, "analysis_logs", async () => {
    const { removeAnalysisLogsForDocument } = await import(
      "@/services/logs/analysis-logs"
    );
    await removeAnalysisLogsForDocument(userId, {
      documentId,
      historyId: id,
    });
  });

  // Critiques pour cohérence dashboard (mémoire / PDF / documents).
  if (documentId) {
    const criticalErrors: string[] = [];

    if (usePersistentStorage()) {
      try {
        await deletePdfObject(userId, documentId);
      } catch (error) {
        logCascadeError(userId, documentId, id, "pdf_s3", error);
        criticalErrors.push("pdf");
      }
      try {
        const { query } = await import("@/lib/db/pool");
        await query(
          `delete from public.app_documents where user_id = $1 and document_id = $2`,
          [userId, documentId],
        );
      } catch (error) {
        logCascadeError(userId, documentId, id, "app_documents", error);
        criticalErrors.push("app_documents");
      }
    } else {
      try {
        await unlink(userPdfPath(userId, documentId));
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: string }).code)
            : "";
        if (code !== "ENOENT") {
          logCascadeError(userId, documentId, id, "pdf_fs", error);
          criticalErrors.push("pdf");
        }
      }
    }

    try {
      const { withKeyedLock } = await import("@/lib/keyed-lock");
      await withKeyedLock(
        `memory:dual:${userId}`,
        async () => {
          await purgeMemoryForDocument(userId, documentId);
        },
        { ttlMs: 120_000 },
      );
    } catch (error) {
      logCascadeError(userId, documentId, id, "memory_purge", error);
      criticalErrors.push("memory");
    }

    if (criticalErrors.length > 0) {
      throw new AppError(
        "INTERNAL_ERROR",
        `Le document a été retiré de l’historique, mais le nettoyage associé a échoué (${criticalErrors.join(", ")}). Réessayez ou contactez le support.`,
        500,
      );
    }
  } else {
    console.warn(
      `[history-delete] userId=${userId} historyId=${id} operation=skip_doc_assets reason=missing_documentId`,
    );
  }
}

export async function updateHistoryFolder(
  userId: string,
  id: string,
  folderId: string | null,
): Promise<HistoryRecord> {
  const record = await getHistoryRecord(userId, id);
  const nextFolderId = normalizeStoredFolderId(folderId);

  const updated: HistoryRecord = {
    ...record,
    folderId: nextFolderId,
  };

  try {
    const ok = await persistHistoryRecordUpdate(updated);
    if (!ok) {
      throw new AppError(
        "NOT_FOUND",
        "Analyse introuvable dans l'historique.",
        404,
      );
    }
    return updated;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "INTERNAL_ERROR",
      "Impossible de déplacer le document.",
      500,
    );
  }
}

export async function updateHistoryRecord(
  userId: string,
  id: string,
  patch: Partial<
    Pick<
      HistoryRecord,
      | "classification"
      | "analysis"
      | "readyReply"
      | "model"
      | "analyzedAt"
      | "extractedText"
      | "fileName"
      | "folderId"
      | "promptsUsed"
      | "displayName"
      | "favorite"
      | "tagIds"
      | "sheet"
      | "folderSource"
      | "analysisPhase"
      | "relationsPhase"
      | "contentHash"
      | "simhash"
      | "primaryEntityIds"
      | "memorySyncedAt"
    >
  >,
): Promise<HistoryRecord> {
  const record = await getHistoryRecord(userId, id);
  let updated: HistoryRecord = {
    ...record,
    ...patch,
    folderId:
      patch.folderId !== undefined
        ? normalizeStoredFolderId(patch.folderId)
        : record.folderId,
    folderSource:
      patch.folderSource !== undefined
        ? patch.folderSource
        : record.folderSource,
    tagIds: patch.tagIds !== undefined ? patch.tagIds : record.tagIds,
    favorite:
      patch.favorite !== undefined ? Boolean(patch.favorite) : record.favorite,
    displayName:
      patch.displayName !== undefined ? patch.displayName : record.displayName,
  };

  const sheetNeedsRebuild =
    patch.analysis !== undefined ||
    patch.classification !== undefined ||
    patch.displayName !== undefined ||
    patch.fileName !== undefined ||
    patch.analyzedAt !== undefined;

  if (sheetNeedsRebuild || !updated.sheet) {
    updated = {
      ...updated,
      sheet: buildDocumentSheet(updated),
    };
  }

  // Reclassement auto si dossier non choisi manuellement
  if (
    patch.folderSource !== "manual" &&
    updated.folderSource !== "manual" &&
    (patch.analysis !== undefined ||
      patch.classification !== undefined ||
      !updated.folderId)
  ) {
    const autoFolder = resolveAutoFolderId(updated);
    if (autoFolder) {
      updated = {
        ...updated,
        folderId: autoFolder,
        folderSource: "auto",
      };
    }
  }

  try {
    const ok = await persistHistoryRecordUpdate(updated);
    if (!ok) {
      throw new AppError(
        "NOT_FOUND",
        "Analyse introuvable (supprimée pendant l’analyse).",
        404,
      );
    }

    if (sheetNeedsRebuild || !record.sheet) {
      await indexDocumentSheet(userId, updated).catch(() => undefined);
    }

    const analysisChanged =
      patch.analysis !== undefined ||
      patch.classification !== undefined ||
      patch.extractedText !== undefined ||
      patch.analysisPhase === "complete";
    if (analysisChanged) {
      scheduleMemoryDualWrite(updated);
    }

    return updated;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "INTERNAL_ERROR",
      "Impossible de mettre à jour l'analyse.",
      500,
    );
  }
}

export async function patchHistoryDocument(
  userId: string,
  id: string,
  input: PatchHistoryInput,
): Promise<HistoryRecord> {
  const patch: Parameters<typeof updateHistoryRecord>[2] = {};

  if ("folderId" in input) {
    patch.folderId = input.folderId ?? null;
    // Choix utilisateur : ne plus auto-reclasser
    patch.folderSource = "manual";
  }
  if ("displayName" in input) {
    const name = input.displayName?.trim() || null;
    patch.displayName = name;
  }
  if (typeof input.fileName === "string" && input.fileName.trim()) {
    patch.fileName = input.fileName.trim();
  }
  if (typeof input.favorite === "boolean") {
    patch.favorite = input.favorite;
  }
  if (Array.isArray(input.tagIds)) {
    patch.tagIds = input.tagIds;
  }

  if (Object.keys(patch).length === 0) {
    throw new AppError("BAD_REQUEST", "Aucun champ à mettre à jour.");
  }

  return updateHistoryRecord(userId, id, patch);
}

export function getUserPdfAbsolutePath(
  userId: string,
  documentId: string,
): string {
  return userPdfPath(userId, assertSafeResourceId(documentId, "documentId"));
}
