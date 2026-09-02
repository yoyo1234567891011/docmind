import type {
  DocumentAnalysis,
  DocumentClassification,
  LetterTypeSuggestion,
} from "@/types";

import {
  rankLetterIntents,
  resolveLetterDocFamily,
} from "./letter-intents";

export type { LetterTypeSuggestion };

function corpusFrom(
  documentText: string,
  analysis: DocumentAnalysis,
): string {
  return [
    documentText,
    analysis.document_type,
    analysis.title,
    analysis.summary,
    ...analysis.important_points,
    ...analysis.risks,
    ...analysis.actions,
    ...analysis.deadlines,
  ].join("\n");
}

/**
 * Suggère le type de courrier à partir du type de document et des infos extraites.
 * Utilise la même taxonomie que le ranking « Points à surveiller ».
 */
export function suggestLetterType(
  documentText: string,
  analysis: DocumentAnalysis,
  classification: DocumentClassification,
): LetterTypeSuggestion {
  const corpus = corpusFrom(documentText, analysis);
  const family = resolveLetterDocFamily(documentText, analysis, classification);
  const ranked = rankLetterIntents(corpus, family);

  const [primary, ...rest] = ranked;

  return {
    letterType: primary.letterType,
    reason: primary.reason,
    confidence: primary.confidence,
    docFamily: family,
    alternatives: rest.slice(0, 2).map((alt) => ({
      letterType: alt.letterType,
      reason: alt.reason,
      confidence: alt.confidence,
    })),
  };
}
