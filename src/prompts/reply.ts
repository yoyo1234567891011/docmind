import type { DocumentAnalysis, DocumentClassification } from "@/types";
import {
  applyPromptTemplate,
  getActivePromptTemplateSync,
} from "@/services/admin/runtime";

interface ReadyReplyPromptInput {
  documentText: string;
  analysis: DocumentAnalysis;
  classification: DocumentClassification;
}

/**
 * Prompt to generate a professional ready-to-send reply letter.
 */
export function buildReadyReplyPrompt({
  documentText,
  analysis,
  classification,
}: ReadyReplyPromptInput): string {
  const context = {
    document_type: analysis.document_type || classification.label,
    title: analysis.title,
    date: analysis.date,
    people: analysis.people,
    organizations: analysis.organizations,
    amounts: analysis.amounts,
    deadlines: analysis.deadlines,
    important_points: analysis.important_points,
    risks: analysis.risks,
    actions: analysis.actions,
  };

  const schema = JSON.stringify(
    {
      required: true,
      reason: "",
      subject: "",
      body: "",
    },
    null,
    2,
  );

  const vars = {
    schema,
    analysisContext: JSON.stringify(context, null, 2),
    documentText: documentText.trim(),
  };

  const override = getActivePromptTemplateSync("reply");
  if (override) {
    return applyPromptTemplate(override, vars);
  }

  return [
    "Tu es un rédacteur professionnel spécialisé en courriers administratifs, juridiques et commerciaux.",
    "Le document reçu nécessite une réponse. Rédige un courrier prêt à envoyer.",
    "",
    "RÈGLES ABSOLUES :",
    "1. Réponds UNIQUEMENT avec un objet JSON valide.",
    "2. N'ajoute aucun texte avant ou après le JSON.",
    "3. N'utilise jamais de markdown, de backticks, ni de bloc de code.",
    "4. Le ton doit être professionnel, clair, courtois et ferme si nécessaire.",
    "5. Le courrier doit être en français.",
    "6. Adapte le contenu au contexte exact du document.",
    "7. N'invente pas de faits absents du document ou du contexte fourni.",
    "8. Si des informations d'identité manquent, utilise des mentions génériques entre crochets comme [Votre nom], [Adresse].",
    "",
    "SCHÉMA EXACT :",
    schema,
    "",
    "SIGNIFICATION DES CHAMPS :",
    '- "required": toujours true ici.',
    '- "reason": pourquoi une réponse est nécessaire (1 ou 2 phrases).',
    '- "subject": objet du courrier.',
    '- "body": corps complet du courrier, avec formules d\'appel et de politesse, prêt à copier-coller.',
    "",
    "CONTEXTE STRUCTURÉ :",
    JSON.stringify(context, null, 2),
    "",
    "DOCUMENT SOURCE :",
    "<<<DOCUMENT>>>",
    documentText.trim(),
    "<<<FIN_DOCUMENT>>>",
    "",
    "Réponds maintenant exclusivement avec le JSON demandé.",
  ].join("\n");
}
