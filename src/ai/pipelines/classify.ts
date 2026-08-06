import {
  classifyDocumentHeuristic,
  isHeuristicConfident,
} from "@/ai/classification/heuristic";
import { generateForTask } from "@/ai/models";
import { buildClassificationPrompt } from "@/ai/prompts";
import { prepareDocumentTextForClassify } from "@/ai/utils/prepare-document-text";
import { parseClassificationResponse } from "@/ai/validation";
import { docmindConfig } from "@/config/docmind";
import { DOCUMENT_CATEGORY_LABELS } from "@/types";
import type { DocumentClassification } from "@/types";
import type { OllamaGenerateResult } from "@/ai/models/types";

function emptyGeneration(model = "heuristic"): OllamaGenerateResult {
  return {
    text: "",
    model,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    durationMs: 0,
  };
}

/**
 * Pipeline: classify — heuristique d’abord, LLM optionnel, jamais d’exception.
 */
export async function classifyDocumentText(
  documentText: string,
): Promise<DocumentClassification> {
  const result = await classifyDocumentTextWithMeta(documentText);
  return result.classification;
}

export async function classifyDocumentTextWithMeta(
  documentText: string,
): Promise<{
  classification: DocumentClassification;
  generation: OllamaGenerateResult;
  source: "heuristic" | "llm" | "fallback";
}> {
  const heuristic = classifyDocumentHeuristic(documentText);

  if (
    docmindConfig.ollama.skipLlmClassifyByDefault ||
    isHeuristicConfident(heuristic)
  ) {
    return {
      classification: heuristic,
      generation: emptyGeneration(
        heuristic.category === "autre" ? "fallback" : "heuristic",
      ),
      source: heuristic.category === "autre" ? "fallback" : "heuristic",
    };
  }

  try {
    const prompt = buildClassificationPrompt(
      prepareDocumentTextForClassify(documentText),
    );
    const generation = await generateForTask("classify", prompt);
    const parsed = parseClassificationResponse(generation.text);

    if (
      parsed.category === "autre" &&
      heuristic.category !== "autre" &&
      heuristic.confidence > 0
    ) {
      return {
        classification: heuristic,
        generation,
        source: "heuristic",
      };
    }

    return {
      classification: parsed,
      generation,
      source: "llm",
    };
  } catch {
    return {
      classification:
        heuristic.category !== "autre"
          ? heuristic
          : {
              category: "autre",
              label: DOCUMENT_CATEGORY_LABELS.autre,
              confidence: 0,
            },
      generation: emptyGeneration("fallback"),
      source: heuristic.category !== "autre" ? "heuristic" : "fallback",
    };
  }
}
