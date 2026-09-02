import { generateForTask } from "@/ai/models";
import { buildLetterAgentPrompt } from "@/ai/agents/prompts/letter";
import { parseReadyReplyResponse } from "@/ai/validation";
import {
  filterDeadlinesForLetter,
  resolveLetterDocFamily,
  shortenLetterSubject,
} from "@/services/reply/letter-intents";
import { buildFallbackLetter } from "@/services/reply/fallback-letter";
import { suggestLetterType } from "@/services/reply/suggest-type";
import type { OllamaGenerateResult } from "@/ai/models/types";
import type {
  DocumentAnalysis,
  DocumentClassification,
  DocumentSheet,
  LetterType,
  ReadyReply,
} from "@/types";
import { LETTER_TYPES } from "@/types";

export interface LetterAgentInput {
  documentText: string;
  analysis: DocumentAnalysis;
  classification: DocumentClassification;
  sheet?: DocumentSheet | null;
  /** "auto" = suggestion depuis l’analyse */
  letterType?: LetterType | "auto";
}

export interface LetterAgentResult {
  letter: ReadyReply;
  letterType: LetterType;
  suggestionReason: string;
  generation: OllamaGenerateResult | null;
  source: "llm" | "fallback";
}

function normalizeLetterType(value: unknown, fallback: LetterType): LetterType {
  const raw = String(value ?? "").trim();
  if ((LETTER_TYPES as string[]).includes(raw)) {
    return raw as LetterType;
  }
  return fallback;
}

/**
 * Agent rédaction de courrier — utilise les infos extraites (fiche + analyse).
 */
export async function runLetterAgent(
  input: LetterAgentInput,
): Promise<LetterAgentResult> {
  const suggestion = suggestLetterType(
    input.documentText,
    input.analysis,
    input.classification,
  );

  const letterType =
    !input.letterType || input.letterType === "auto"
      ? suggestion.letterType
      : input.letterType;

  const family = resolveLetterDocFamily(
    input.documentText,
    input.analysis,
    input.classification,
  );
  const safeDeadlines = filterDeadlinesForLetter(input.analysis.deadlines);

  const prompt = buildLetterAgentPrompt({
    letterType,
    documentText: input.documentText,
    analysis: input.analysis,
    classification: input.classification,
    sheet: input.sheet,
  });

  try {
    const generation = await generateForTask("reply", prompt);
    const parsed = parseReadyReplyResponse(
      generation.text,
      suggestion.reason,
    );
    const letter: ReadyReply = {
      ...parsed,
      required: true,
      letterType: normalizeLetterType(parsed.letterType, letterType),
      subject: shortenLetterSubject(
        parsed.subject || "",
        normalizeLetterType(parsed.letterType, letterType),
        family,
      ),
      recipient:
        parsed.recipient ||
        input.sheet?.organizations?.[0] ||
        input.analysis.organizations[0] ||
        "",
      factsUsed:
        parsed.factsUsed && parsed.factsUsed.length > 0
          ? parsed.factsUsed
          : [
              input.analysis.title,
              ...input.analysis.amounts.slice(0, 2),
              ...safeDeadlines.slice(0, 2),
            ].filter(Boolean),
    };

    return {
      letter,
      letterType: letter.letterType || letterType,
      suggestionReason: suggestion.reason,
      generation,
      source: "llm",
    };
  } catch {
    const letter = buildFallbackLetter(
      letterType,
      input.analysis,
      input.classification,
      suggestion.reason,
      input.documentText,
    );
    return {
      letter,
      letterType,
      suggestionReason: suggestion.reason,
      generation: null,
      source: "fallback",
    };
  }
}
