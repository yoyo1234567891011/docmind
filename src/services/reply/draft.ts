import { runLetterAgent } from "@/ai/agents/letter-agent";
import { requireEntitlement } from "@/services/billing";
import { getHistoryRecord, updateHistoryRecord } from "@/services/history";
import { ensureDocumentSheet } from "@/services/sheets";
import { suggestLetterType } from "@/services/reply/suggest-type";
import type { LetterType, ReadyReply } from "@/types";

export interface DraftLetterOptions {
  userId: string;
  historyId: string;
  letterType?: LetterType | "auto";
  /** Persister le courrier sur la fiche historique (défaut true). */
  persist?: boolean;
}

export interface DraftLetterResult {
  letter: ReadyReply;
  letterType: LetterType;
  suggestionReason: string;
  source: "llm" | "fallback";
  historyId: string;
}

/**
 * Rédige un courrier pour un document déjà analysé (historique).
 */
export async function draftLetterForHistory(
  options: DraftLetterOptions,
): Promise<DraftLetterResult> {
  await requireEntitlement(options.userId, "letter_agent");

  const record = await getHistoryRecord(options.userId, options.historyId);
  const sheet = ensureDocumentSheet(record);

  const agent = await runLetterAgent({
    documentText: record.extractedText || "",
    analysis: record.analysis,
    classification: record.classification,
    sheet,
    letterType: options.letterType ?? "auto",
  });

  if (options.persist !== false) {
    await updateHistoryRecord(options.userId, options.historyId, {
      readyReply: agent.letter,
    });
  }

  return {
    letter: agent.letter,
    letterType: agent.letterType,
    suggestionReason: agent.suggestionReason,
    source: agent.source,
    historyId: options.historyId,
  };
}

export function previewLetterSuggestion(
  documentText: string,
  analysis: Parameters<typeof suggestLetterType>[1],
  classification: Parameters<typeof suggestLetterType>[2],
) {
  return suggestLetterType(documentText, analysis, classification);
}
