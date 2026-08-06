import path from "path";

import { getEmbedModel } from "@/ai/models/config";
import { embedText } from "@/ai/models/embeddings";
import {
  userSearchIndexDir,
  userSearchIndexFile,
} from "@/config/paths";
import {
  userFileEnsureDir,
  userFileList,
  userFileRead,
  userFileUnlink,
  userFileWrite,
} from "@/lib/user-files";
import {
  buildDocumentSheet,
  buildSheetSearchText,
} from "@/services/sheets/build";
import type {
  DocumentSearchIndexEntry,
  DocumentSheet,
  HistoryRecord,
} from "@/types";

async function ensureIndexDir(userId: string): Promise<string> {
  const dir = userSearchIndexDir(userId);
  await userFileEnsureDir(dir);
  return dir;
}

/**
 * Indexe une fiche pour la recherche IA (texte + embedding si Ollama dispo).
 */
export async function indexDocumentSheet(
  userId: string,
  record: HistoryRecord,
  options?: { skipEmbedding?: boolean },
): Promise<DocumentSearchIndexEntry> {
  await ensureIndexDir(userId);

  const sheet = record.sheet ?? buildDocumentSheet(record);
  const searchText = buildSheetSearchText(sheet);

  let embedding: number[] | null = null;
  let embeddingModel: string | null = null;

  if (!options?.skipEmbedding) {
    try {
      embedding = await embedText(searchText.slice(0, 6000));
      embeddingModel = getEmbedModel();
    } catch {
      embedding = null;
      embeddingModel = null;
    }
  }

  const entry: DocumentSearchIndexEntry = {
    historyId: record.id,
    documentId: record.documentId,
    sheet,
    searchText,
    embedding,
    embeddingModel,
    indexedAt: new Date().toISOString(),
  };

  await userFileWrite(
    userId,
    userSearchIndexFile(userId, record.id),
    JSON.stringify(entry, null, 2),
  );

  return entry;
}

export async function getSearchIndexEntry(
  userId: string,
  historyId: string,
): Promise<DocumentSearchIndexEntry | null> {
  try {
    const raw = await userFileRead(
      userId,
      userSearchIndexFile(userId, historyId),
    );
    if (!raw) return null;
    return JSON.parse(raw) as DocumentSearchIndexEntry;
  } catch {
    return null;
  }
}

export async function listSearchIndexEntries(
  userId: string,
): Promise<DocumentSearchIndexEntry[]> {
  try {
    const dir = await ensureIndexDir(userId);
    const files = (await userFileList(userId, dir)).filter((f) =>
      f.endsWith(".json"),
    );
    const entries = await Promise.all(
      files.map(async (file) => {
        try {
          const raw = await userFileRead(userId, path.join(dir, file));
          if (!raw) return null;
          return JSON.parse(raw) as DocumentSearchIndexEntry;
        } catch {
          return null;
        }
      }),
    );
    return entries.filter(Boolean) as DocumentSearchIndexEntry[];
  } catch {
    return [];
  }
}

export async function removeSearchIndexEntry(
  userId: string,
  historyId: string,
): Promise<void> {
  await userFileUnlink(userId, userSearchIndexFile(userId, historyId));
}

export async function reindexHistoryRecord(
  userId: string,
  record: HistoryRecord,
): Promise<{ sheet: DocumentSheet; entry: DocumentSearchIndexEntry }> {
  const sheet = buildDocumentSheet(record);
  const withSheet: HistoryRecord = { ...record, sheet };
  const entry = await indexDocumentSheet(userId, withSheet);
  return { sheet, entry };
}
