import { randomUUID } from "crypto";

import { userAnalysisLogsFile } from "@/config/paths";
import { userFileRead, userFileWrite } from "@/lib/user-files";
import type {
  AnalysisLogEntry,
  AnalysisLogsFile,
} from "@/types/analysis-log";

const MAX_ENTRIES = 1000;

export async function readAnalysisLogs(
  userId: string,
): Promise<AnalysisLogsFile> {
  try {
    const raw = await userFileRead(userId, userAnalysisLogsFile(userId));
    if (!raw) return { entries: [] };
    return JSON.parse(raw) as AnalysisLogsFile;
  } catch {
    return { entries: [] };
  }
}

async function writeLogs(
  userId: string,
  file: AnalysisLogsFile,
): Promise<void> {
  await userFileWrite(
    userId,
    userAnalysisLogsFile(userId),
    JSON.stringify(file, null, 2),
  );
}

export async function appendAnalysisLog(
  userId: string,
  entry: Omit<AnalysisLogEntry, "id" | "at"> & { at?: string; id?: string },
): Promise<AnalysisLogEntry> {
  const file = await readAnalysisLogs(userId);
  const full: AnalysisLogEntry = {
    id: entry.id ?? randomUUID(),
    at: entry.at ?? new Date().toISOString(),
    documentId: entry.documentId,
    historyId: entry.historyId ?? null,
    fileName: entry.fileName,
    category: entry.category,
    categoryLabel: entry.categoryLabel,
    model: entry.model,
    promptsUsed: entry.promptsUsed,
    durationMs: entry.durationMs,
    tokens: entry.tokens,
    steps: entry.steps,
    result: entry.result,
    ok: entry.ok,
    errorCode: entry.errorCode,
    errorMessage: entry.errorMessage,
  };

  file.entries.unshift(full);
  if (file.entries.length > MAX_ENTRIES) {
    file.entries = file.entries.slice(0, MAX_ENTRIES);
  }

  await writeLogs(userId, file);
  return full;
}

export async function attachHistoryIdToLatestLog(
  userId: string,
  documentId: string,
  historyId: string,
): Promise<void> {
  const file = await readAnalysisLogs(userId);
  const entry = file.entries.find((item) => item.documentId === documentId);
  if (!entry) return;
  entry.historyId = historyId;
  await writeLogs(userId, file);
}

/** Retire les logs d’analyse liés à un document / historique supprimé. */
export async function removeAnalysisLogsForDocument(
  userId: string,
  input: { documentId?: string | null; historyId?: string | null },
): Promise<void> {
  const documentId = input.documentId?.trim() || null;
  const historyId = input.historyId?.trim() || null;
  if (!documentId && !historyId) return;

  const file = await readAnalysisLogs(userId);
  const next = file.entries.filter((entry) => {
    if (documentId && entry.documentId === documentId) return false;
    if (historyId && entry.historyId === historyId) return false;
    return true;
  });
  if (next.length === file.entries.length) return;
  await writeLogs(userId, { entries: next });
}

export async function getAnalysisLog(
  userId: string,
  id: string,
): Promise<AnalysisLogEntry | null> {
  const file = await readAnalysisLogs(userId);
  return file.entries.find((e) => e.id === id) ?? null;
}
