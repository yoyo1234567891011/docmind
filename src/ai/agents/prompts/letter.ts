import type { WatchDocFamily } from "@/ai/post-processing/watch-ranking";
import type {
  DocumentAnalysis,
  DocumentClassification,
  DocumentSheet,
  LetterType,
} from "@/types";
import { LETTER_TYPE_LABELS } from "@/types";
import {
  filterDeadlinesForLetter,
  LETTER_FAMILY_RULES,
  resolveLetterDocFamily,
} from "@/services/reply/letter-intents";

interface LetterPromptInput {
  letterType: LetterType;
  documentText: string;
  analysis: DocumentAnalysis;
  classification: DocumentClassification;
  sheet?: DocumentSheet | null;
}

const TYPE_INSTRUCTIONS: Record<LetterType, string> = {
  resiliation:
    "Rédige une lettre de RÉSILATION ou de CONGÉ : intention claire, référence du contrat/abonnement/bail, date d’effet souhaitée si connue, demande de confirmation écrite. N’utilise JAMAIS ce type pour un relevé bancaire ou un document informatif sans contrat résiliable.",
  remboursement:
    "Rédige une DEMANDE DE REMBOURSEMENT : montant(s) du contexte, motif factuel, référence facture/opération, délai de réponse souhaité.",
  contestation:
    "Rédige une CONTESTATION formelle : faits contestés (frais, montants, opérations), références du document, demande de réexamen et de réponse écrite.",
  reponse_administrative:
    "Rédige une RÉPONSE ADMINISTRATIVE professionnelle : reprise des références, réponse point par point, pièces éventuelles, ton courtois et factuel.",
  autre:
    "Rédige une DEMANDE D’INFORMATION ou de CLARIFICATION : question précise, références du document, sans inventer de litige ni de résiliation.",
};

const FAMILY_FORBIDDEN: Partial<Record<WatchDocFamily, string[]>> = {
  banque: [
    "Ne pas rédiger de résiliation (un relevé n’est pas un contrat).",
    "Ne pas citer comme « échéance de résiliation » une obligation du client (ex. signaler un changement d’adresse).",
    "Ne pas reprendre le titre technique du PDF (« Relevé de compte — période du… ») comme objet.",
  ],
  recouvrement: [
    "Ne pas inventer une résiliation de contrat.",
    "Ne pas transformer une mise en demeure de payer en demande de résiliation.",
  ],
  administratif: [
    "Ne pas proposer de résiliation commerciale.",
    "Ne pas demander un remboursement sans montant contesté dans le contexte.",
  ],
  pret: [
    "Ne pas utiliser le terme « résiliation » pour un prêt — parler de remboursement anticipé ou rétractation si applicable.",
  ],
  default: [
    "Sans contrat clairement identifiable, rester sur une demande d’information.",
    "Ne pas supposer de résiliation par défaut.",
  ],
};

/**
 * Prompt agent rédacteur de courrier — s’appuie sur la fiche / l’analyse.
 */
export function buildLetterAgentPrompt(input: LetterPromptInput): string {
  const { letterType, analysis, classification, sheet, documentText } = input;
  const family = resolveLetterDocFamily(
    documentText,
    analysis,
    classification,
  );
  const familyRule = LETTER_FAMILY_RULES[family];
  const forbidden = FAMILY_FORBIDDEN[family] ?? FAMILY_FORBIDDEN.default ?? [];

  const deadlines = filterDeadlinesForLetter(
    sheet?.deadlines?.length ? sheet.deadlines : analysis.deadlines,
  );

  const facts = {
    letterType,
    letterTypeLabel: LETTER_TYPE_LABELS[letterType],
    docFamily: family,
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
    deadlines,
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
    `FAMILLE DOCUMENTAIRE : ${family} (types autorisés : ${familyRule.allowed.join(", ")}).`,
    "",
    "INTERDICTIONS SPÉCIFIQUES À CE DOCUMENT :",
    ...forbidden.map((line) => `- ${line}`),
    "",
    "RÈGLES ABSOLUES :",
    "1. Réponds UNIQUEMENT avec un objet JSON valide (pas de markdown).",
    "2. Utilise UNIQUEMENT les informations du CONTEXTE STRUCTURÉ (et du document si cohérent).",
    "3. N’invente aucun fait, montant, date, nom ou clause absent du contexte.",
    "4. Si une info manque, utilise un placeholder entre crochets : [Votre nom], [Adresse], etc.",
    "5. Ton professionnel, clair, courtois ; ferme si contestation.",
    "6. subject = objet COURT (≤ 80 caractères), sans période du/au ni titre technique du PDF.",
    "7. body = courrier complet prêt à copier-coller (appel + corps + formule de politesse).",
    "8. factsUsed = liste courte des faits réellement repris dans le courrier.",
    "9. recipient = organisation/service destinataire si connu, sinon chaîne vide.",
    "10. Ne cite comme échéance contractuelle que les dates à l’initiative de l’émetteur (pas les obligations du client).",
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
