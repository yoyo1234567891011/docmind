import type {
  DocumentAnalysis,
  DocumentCategory,
  DocumentClassification,
} from "@/types";

const RESPONSE_KEYWORDS = [
  /veuillez\s+(?:nous\s+)?(?:répondre|retourner|adresser|faire\s+parvenir)/i,
  /merci\s+de\s+(?:bien\s+vouloir\s+)?(?:répondre|retourner|contester|régulariser)/i,
  /nous\s+vous\s+prions/i,
  /sous\s+peine/i,
  /mise\s+en\s+demeure/i,
  /d[ée]lai\s+de\s+r[ée]ponse/i,
  /[àa]\s+retourner/i,
  /r[ée]ponse\s+(?:attendue|souhaitee|souhaitée|exig[ée]e)/i,
  /contester/i,
  /r[ée]clamation/i,
  /observation(s)?\s+[àa]\s+formuler/i,
  /nous\s+attendre\s+[àa]\s+votre\s+r[ée]ponse/i,
  /courrier\s+de\s+r[ée]ponse/i,
  /justificatif(s)?\s+[àa]\s+(?:fournir|envoyer)/i,
];

const ACTION_REPLY_KEYWORDS = [
  /r[ée]pondre/i,
  /contester/i,
  /envoyer\s+un\s+courrier/i,
  /r[ée]clamer/i,
  /demander\s+un\s+(?:d[ée]lai|justificatif)/i,
  /prendre\s+contact/i,
  /r[ée]gulariser/i,
];

const CATEGORIES_OFTEN_NEEDING_REPLY: DocumentCategory[] = [
  "courrier-administratif",
  "impots",
  "banque",
  "assurance",
  "facture",
  "contrat-de-travail",
];

export interface ReplyNeedAssessment {
  required: boolean;
  reason: string;
}

function collectCorpus(
  documentText: string,
  analysis: DocumentAnalysis,
): string {
  return [
    documentText,
    ...analysis.important_points,
    ...analysis.risks,
    ...analysis.actions,
    ...analysis.deadlines,
  ].join("\n");
}

/**
 * Determines whether the document likely requires a written reply.
 */
export function assessReplyNeed(
  documentText: string,
  analysis: DocumentAnalysis,
  classification: DocumentClassification,
): ReplyNeedAssessment {
  const corpus = collectCorpus(documentText, analysis);
  const matchedKeywords = RESPONSE_KEYWORDS.filter((pattern) =>
    pattern.test(corpus),
  );
  const matchedActions = analysis.actions.filter((action) =>
    ACTION_REPLY_KEYWORDS.some((pattern) => pattern.test(action)),
  );
  const categorySuggestsReply = CATEGORIES_OFTEN_NEEDING_REPLY.includes(
    classification.category,
  );
  const hasDeadlinePressure =
    analysis.deadlines.length > 0 &&
    (matchedKeywords.length > 0 || matchedActions.length > 0);

  if (matchedKeywords.length > 0) {
    return {
      required: true,
      reason:
        "Le document contient une demande explicite de réponse ou de retour.",
    };
  }

  if (matchedActions.length > 0) {
    return {
      required: true,
      reason: `Les actions recommandées impliquent une réponse écrite (${matchedActions[0]}).`,
    };
  }

  if (hasDeadlinePressure) {
    return {
      required: true,
      reason:
        "Une échéance est associée à une démarche ou un échange à formaliser.",
    };
  }

  if (categorySuggestsReply && analysis.deadlines.length > 0) {
    return {
      required: true,
      reason: `Ce type de document (${classification.label}) comporte une échéance justifiant souvent une réponse.`,
    };
  }

  return {
    required: false,
    reason: "Aucune demande de réponse n'a été identifiée dans ce document.",
  };
}
