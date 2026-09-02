import { generateForTask } from "@/ai/models";
import { buildLetterAgentPrompt } from "@/ai/agents/prompts/letter";
import { parseReadyReplyResponse } from "@/ai/validation";
import {
  filterDeadlinesForLetter,
  resolveLetterDocFamily,
  shortenLetterSubject,
} from "@/services/reply/letter-intents";
import {
  collectAllowedLetterFacts,
  deriveFactsUsedInLetter,
  sanitizeRecipient,
  stripInventedAddressesFromBody,
  validateLetterBody,
} from "@/services/reply/letter-quality";
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

function analysisCorpus(analysis: DocumentAnalysis): string {
  return [
    analysis.title,
    analysis.summary,
    ...analysis.important_points,
    ...analysis.amounts,
    ...analysis.organizations,
  ].join("\n");
}

function finalizeLetter(input: {
  parsed: ReadyReply;
  letterType: LetterType;
  family: ReturnType<typeof resolveLetterDocFamily>;
  allowedFacts: ReturnType<typeof collectAllowedLetterFacts>;
  documentText: string;
  analysis: DocumentAnalysis;
  sheet?: DocumentSheet | null;
  suggestionReason: string;
}): ReadyReply {
  const orgs = [
    ...(input.sheet?.organizations ?? []),
    ...input.analysis.organizations,
  ];
  const corpus = analysisCorpus(input.analysis);

  const body = stripInventedAddressesFromBody(
    input.parsed.body,
    input.documentText,
    corpus,
  );

  const normalizedType = normalizeLetterType(
    input.parsed.letterType,
    input.letterType,
  );

  return {
    required: true,
    reason: input.parsed.reason || input.suggestionReason,
    subject: shortenLetterSubject(
      input.parsed.subject || "",
      normalizedType,
      input.family,
    ),
    body,
    letterType: normalizedType,
    recipient: sanitizeRecipient(
      input.parsed.recipient || "",
      orgs,
      input.documentText,
      corpus,
    ),
    factsUsed: deriveFactsUsedInLetter(body, input.allowedFacts),
  };
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

  const allowedFacts = collectAllowedLetterFacts({
    documentText: input.documentText,
    analysis: input.analysis,
    sheet: input.sheet,
    letterType,
    family,
  });

  const prompt = buildLetterAgentPrompt({
    letterType,
    documentText: input.documentText,
    analysis: input.analysis,
    classification: input.classification,
    sheet: input.sheet,
  });

  const fallback = () =>
    buildFallbackLetter(
      letterType,
      input.analysis,
      input.classification,
      suggestion.reason,
      input.documentText,
      input.sheet,
    );

  try {
    const generation = await generateForTask("reply", prompt, {
      maxTokens: 1200,
    });
    const parsed = parseReadyReplyResponse(
      generation.text,
      suggestion.reason,
    );

    const letter = finalizeLetter({
      parsed,
      letterType,
      family,
      allowedFacts,
      documentText: input.documentText,
      analysis: input.analysis,
      sheet: input.sheet,
      suggestionReason: suggestion.reason,
    });

    const validation = validateLetterBody(letter.body);
    const truncated =
      generation.finishReason === "length" ||
      generation.completionTokens >= 1150;

    if (!validation.valid || truncated) {
      const fb = fallback();
      return {
        letter: fb,
        letterType,
        suggestionReason: suggestion.reason,
        generation,
        source: "fallback",
      };
    }

    if ((letter.factsUsed?.length ?? 0) === 0 && allowedFacts.length > 0) {
      letter.factsUsed = deriveFactsUsedInLetter(letter.body, allowedFacts);
    }

    return {
      letter,
      letterType: letter.letterType || letterType,
      suggestionReason: suggestion.reason,
      generation,
      source: "llm",
    };
  } catch {
    const letter = fallback();
    return {
      letter,
      letterType,
      suggestionReason: suggestion.reason,
      generation: null,
      source: "fallback",
    };
  }
}
