import type {
  DocumentAnalysis,
  DocumentClassification,
  DocumentSheet,
  LetterType,
} from "@/types";
import { LETTER_TYPE_LABELS } from "@/types";

interface LetterPromptInput {
  letterType: LetterType;
  documentText: string;
  analysis: DocumentAnalysis;
  classification: DocumentClassification;
  sheet?: DocumentSheet | null;
}

const TYPE_INSTRUCTIONS: Record<LetterType, string> = {
  resiliation:
    "Rédige une lettre de RÉSILATION claire : intention de résilier, référence du contrat, date d’effet souhaitée si connue, demande de confirmation écrite.",
  remboursement:
    "Rédige une DEMANDE DE REMBOURSEMENT : montant, motif, référence du document/facture, délai de réponse souhaité.",
  contestation:
    "Rédige une CONTESTATION formelle : faits contestés, montants le cas échéant, demande de réexamen et de réponse écrite.",
  reponse_administrative:
    "Rédige une RÉPONSE ADMINISTRATIVE professionnelle : reprise des références, réponse point par point, ton courtois et factuel.",
  autre:
    "Rédige un courrier professionnel adapté au contexte du document, sans inventer de faits.",
};

/**
 * Prompt agent rédacteur de courrier — s’appuie sur la fiche / l’analyse.
 */
export function buildLetterAgentPrompt(input: LetterPromptInput): string {
  const { letterType, analysis, classification, sheet, documentText } = input;

  const facts = {
    letterType,
    letterTypeLabel: LETTER_TYPE_LABELS[letterType],
    document_type: analysis.document_type || classification.label,
    category: classification.category,
    title: sheet?.name || analysis.title,
    summary: sheet?.summary || analysis.summary,
    date: analysis.date,
    dates: sheet?.dates?.length ? sheet.dates : analysis.dates,
    people: sheet?.people?.length ? sheet.people : analysis.people,
    organizations: sheet?.organizations?.length
      ? sheet.organizations
      : analysis.organizations,
    amounts: sheet?.amounts?.length ? sheet.amounts : analysis.amounts,
    deadlines: sheet?.deadlines?.length
      ? sheet.deadlines
      : analysis.deadlines,
    risks: sheet?.risks?.length ? sheet.risks : analysis.risks,
    actions: sheet?.actions?.length ? sheet.actions : analysis.actions,
    important_points: analysis.important_points,
    keywords: sheet?.keywords ?? [],
  };

  const schema = {
    required: true,
    reason: "",
    subject: "",
    body: "",
    letterType,
    recipient: "",
    factsUsed: ["fait 1", "fait 2"],
  };

  return [
    "Tu es un agent rédacteur de courriers administratifs et juridiques (français).",
    `TYPE DEMANDÉ : ${LETTER_TYPE_LABELS[letterType]} (${letterType}).`,
    TYPE_INSTRUCTIONS[letterType],
    "",
    "RÈGLES ABSOLUES :",
    "1. Réponds UNIQUEMENT avec un objet JSON valide (pas de markdown).",
    "2. Utilise UNIQUEMENT les informations du CONTEXTE STRUCTURÉ (et du document si cohérent).",
    "3. N’invente aucun fait, montant, date, nom ou clause absent du contexte.",
    "4. Si une info manque, utilise un placeholder entre crochets : [Votre nom], [Adresse], etc.",
    "5. Ton professionnel, clair, courtois ; ferme si contestation/résiliation.",
    "6. body = courrier complet prêt à copier-coller (appel + corps + formule de politesse).",
    "7. factsUsed = liste courte des faits réellement repris dans le courrier.",
    "8. recipient = organisation/service destinataire si connu, sinon chaîne vide.",
    "",
    "SCHÉMA :",
    JSON.stringify(schema, null, 2),
    "",
    "CONTEXTE STRUCTURÉ (source prioritaire) :",
    JSON.stringify(facts, null, 2),
    "",
    "EXTRAIT DOCUMENT (secours, max utile) :",
    "<<<DOCUMENT>>>",
    documentText.trim().slice(0, 5000),
    "<<<FIN_DOCUMENT>>>",
    "",
    "Réponds maintenant exclusivement avec le JSON demandé.",
  ].join("\n");
}

