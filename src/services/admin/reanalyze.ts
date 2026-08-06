import { analyzeDocumentText } from "@/ai/pipelines";
import {
  getHistoryRecord,
  updateHistoryRecord,
} from "@/services/history";
import { AppError } from "@/lib/errors";
import type { HistoryRecord } from "@/types";

/**
 * Re-run analysis on an existing history record (same extracted text).
 */
export async function reanalyzeHistoryRecord(
  userId: string,
  historyId: string,
  options?: { skipReadyReply?: boolean },
): Promise<HistoryRecord> {
  const record = await getHistoryRecord(userId, historyId);
  const text = record.extractedText?.trim();

  if (!text) {
    throw new AppError(
      "BAD_REQUEST",
      "Ce document n'a pas de texte extrait à réanalyser.",
    );
  }

  const result = await analyzeDocumentText({
    userId,
    documentId: record.documentId,
    text,
    fileName: record.fileName,
    skipReadyReply: options?.skipReadyReply ?? true,
  });

  return updateHistoryRecord(userId, historyId, {
    classification: result.classification,
    analysis: result.analysis,
    readyReply: result.readyReply,
    model: result.model,
    analyzedAt: result.analyzedAt,
    promptsUsed: result.promptsUsed,
  });
}
