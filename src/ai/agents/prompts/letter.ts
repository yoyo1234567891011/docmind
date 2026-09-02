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
import {
  collectAllowedLetterFacts,
  formatFactsForPrompt,
  MIN_LETTER_WORDS,
} from "@/services/reply/letter-quality";

interface LetterPromptInput {
  letterType: LetterType;
  documentText: string;
  analysis: DocumentAnalysis;
  classification: DocumentClassification;
  sheet?: DocumentSheet | null;
}

const TYPE_INSTRUCTIONS: Record<LetterType, string> = {
  resiliation:
    "Rédige une lettre de RÉSILATION ou de CONGÉ : intention claire, référence du contrat/abonnement/bail, date d’effet souhaitée si connue, demande de confirmation écrite. N’utilise JAMAIS ce type pour un relevé bancaire.",
  remboursement:
    "Rédige une DEMANDE DE REMBOURSEMENT : tous les montants pertinents du contexte, motif factuel, référence facture/opération, délai de réponse souhaité (ex. 30 jours).",
  contestation:
    "Rédige une CONTESTATION formelle : cite TOUS les montants/frais listés dans FAITS_AUTORISES (relevé bancaire = chaque commission/frais distinct), demande de réexamen et de réponse écrite sous 30 jours.",
  reponse_administrative:
    "Rédige une RÉPONSE ADMINISTRATIVE professionnelle : reprise des références, réponse point par point, pièces éventuelles, ton courtois et factuel.",
  autre:
    "Rédige une DEMANDE D’INFORMATION ou de CLARIFICATION : question précise, références du document, sans inventer de litige ni de résiliation.",
};

const FAMILY_FORBIDDEN: Partial<Record<WatchDocFamily, string[]>> = {
  banque: [
    "Ne pas rédiger de résiliation (un relevé n’est pas un contrat).",
    "Ne pas citer comme échéance une obligation du client (ex. signaler un changement d’adresse).",
    "Ne pas inventer d’adresse postale (rue, code postal) : nom de l’établissement uniquement, ou [Adresse de l’établissement].",
    "Ne pas omettre de frais listés dans FAITS_AUTORISES lors d’une contestation.",
  ],
  recouvrement: [
    "Ne pas inventer une résiliation de contrat.",
    "Ne pas transformer une mise en demeure de payer en demande de résiliation.",
    "Ne pas inventer d’adresse du créancier.",
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
    "Ne pas inventer d’adresse, IBAN, SIRET ou téléphone.",
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

  const allowedFacts = collectAllowedLetterFacts({
    documentText,
    analysis,
    sheet,
    letterType,
    family,
  });

  const deadlines = filterDeadlinesForLetter(
    sheet?.deadlines?.length ? sheet.deadlines : analysis.deadlines,
  );

  const facts = {
    letterType,
    letterTypeLabel: LETTER_TYPE_LABELS[letterType],
    docFamily: family,
    document_type: analysis.document_type || classification.label,
    category: classification.category,
    date: analysis.date,
    dates: sheet?.dates?.length ? sheet.dates : analysis.dates,
    people: sheet?.people?.length ? sheet.people : analysis.people,
    organizations: sheet?.organizations?.length
      ? sheet.organizations
      : analysis.organizations,
    deadlines,
    FAITS_AUTORISES: formatFactsForPrompt(allowedFacts),
  };

  const schema = {
    required: true,
    reason: "",
    subject: "",
    body: "",
    letterType,
    recipient: "",
    factsUsed: ["uniquement les faits réellement cités dans body"],
  };

  return [
    "Tu es un agent rédacteur de courriers administratifs et juridiques (français impeccable).",
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
    "2. Utilise UNIQUEMENT les entrées de FAITS_AUTORISES — rien d’autre.",
    "3. ZÉRO INVENTION : pas d’adresse, SIRET, IBAN, téléphone, montant ou date absents de FAITS_AUTORISES.",
    "4. recipient = nom de l’organisme uniquement (pas d’adresse postale inventée).",
    "5. subject = objet COURT (≤ 80 caractères), sans période du/au ni titre technique du PDF.",
    `6. body = courrier COMPLET (≥ ${MIN_LETTER_WORDS} mots) : « Madame, Monsieur, » + exposé des faits + demande claire + délai de réponse + formule de politesse + [Votre nom] / [Votre adresse].`,
    "7. Ne termine JAMAIS le corps par une phrase inachevée (ex. « Je » seul).",
    "8. factsUsed = 3 à 8 libellés repris de FAITS_AUTORISES et effectivement cités dans body.",
    "9. Orthographe et accords français corrects ; phrases complètes.",
    "10. N’inclus pas d’obligations génériques du client (changement d’adresse, RIB…) dans body ni factsUsed.",
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
