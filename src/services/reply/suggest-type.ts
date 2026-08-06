import type {
  DocumentAnalysis,
  DocumentClassification,
  LetterType,
  LetterTypeSuggestion,
} from "@/types";

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
 * Suggère le type de courrier à partir des infos extraites.
 */
export function suggestLetterType(
  documentText: string,
  analysis: DocumentAnalysis,
  classification: DocumentClassification,
): LetterTypeSuggestion {
  const corpus = corpusFrom(documentText, analysis);

  if (
    /r[ée]sili|d[ée]nonci|cong[eé]\s+du\s+bail|mettre\s+fin\s+au\s+contrat|pr[ée]avis\s+de\s+r[ée]siliation/i.test(
      corpus,
    )
  ) {
    return {
      letterType: "resiliation",
      reason: "Le document évoque une résiliation ou un préavis.",
      confidence: 0.85,
    };
  }

  if (
    /rembours|trop[- ]?per[çc]u|avoir\s+client|cr[ée]dit\s+[àa]\s+votre\s+faveur|demande\s+de\s+remboursement/i.test(
      corpus,
    )
  ) {
    return {
      letterType: "remboursement",
      reason: "Le contexte indique une demande ou un droit à remboursement.",
      confidence: 0.85,
    };
  }

  if (
    /contest|d[ée]saccord|erreur\s+de\s+facturation|montant\s+erron[ée]|je\s+conteste|litige/i.test(
      corpus,
    )
  ) {
    return {
      letterType: "contestation",
      reason: "Le document ou les actions suggèrent une contestation.",
      confidence: 0.8,
    };
  }

  if (
    classification.category === "courrier-administratif" ||
    classification.category === "impots" ||
    /mise\s+en\s+demeure|administration|r[ée]ponse\s+attendue|observation/i.test(
      corpus,
    )
  ) {
    return {
      letterType: "reponse_administrative",
      reason: "Contexte administratif nécessitant une réponse formelle.",
      confidence: 0.7,
    };
  }

  return {
    letterType: "autre",
    reason: "Type générique — à préciser selon votre objectif.",
    confidence: 0.4,
  };
}

