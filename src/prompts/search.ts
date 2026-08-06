import { EMPTY_SMART_SEARCH_INTENT } from "@/types";
import {
  applyPromptTemplate,
  getActivePromptTemplateSync,
} from "@/services/admin/runtime";

const INTENT_SCHEMA = {
  interpretedAs: "résumé court de la requête comprise",
  keywords: ["mots", "clés"],
  organizations: ["EDF"],
  people: [],
  documentTypes: ["contrat", "facture"],
  categories: [],
  amount: {
    operator: "gt",
    value: 50,
    valueMax: null,
  },
  date: {
    field: "deadline",
    from: null,
    to: null,
    year: 2026,
  },
  riskLevels: [],
  needsAction: null,
  limit: 20,
};

/**
 * Prompt: natural language → structured search intent (JSON only).
 */
export function buildSmartSearchIntentPrompt(query: string): string {
  const year = new Date().getFullYear();
  const schema = JSON.stringify(INTENT_SCHEMA, null, 2);
  const vars = {
    schema,
    query: query.trim(),
    year: String(year),
  };

  const override = getActivePromptTemplateSync("searchIntent");
  if (override) {
    return applyPromptTemplate(override, vars);
  }

  return [
    "Tu es un parseur d'intentions de recherche pour une application de documents administratifs.",
    "Transforme la requête utilisateur en filtres structurés JSON.",
    "",
    "RÈGLES ABSOLUES :",
    "1. Réponds UNIQUEMENT avec un objet JSON valide.",
    "2. Aucun markdown, aucun texte hors JSON.",
    "3. N'invente pas d'organisations absentes de la requête.",
    "4. Si un filtre n'est pas pertinent, utilise [] ou null.",
    "5. amount.value est un nombre en euros (pas de symbole).",
    "6. amount.operator ∈ gt|gte|lt|lte|eq|between.",
    "7. date.field ∈ any|deadline|document|analyzed.",
    "8. date.year est une année calendaire (ex: échéances cette année → " +
      String(year) +
      ").",
    "9. categories ∈ contrat|facture|assurance|banque|impots|bail|courrier-administratif|contrat-de-travail|conditions-generales|autre (ou []).",
    "10. interpretedAs : phrase courte en français expliquant la compréhension.",
    "",
    "EXEMPLES :",
    '- "Quels contrats expirent cette année ?" → documentTypes:["contrat"], date:{field:"deadline",year:' +
      String(year) +
      "}",
    '- "Montre toutes les factures EDF." → organizations:["EDF"], documentTypes:["facture"]',
    '- "Quels abonnements dépassent 40 € ?" → documentTypes:["abonnement"], amount:{operator:"gt",value:40}, keywords:["abonnement"]',
    '- "Quels documents contiennent une clause de renouvellement automatique ?" → keywords:["renouvellement automatique","renouvellement","tacite"]',
    '- "Retrouve mon contrat EDF" → organizations:["EDF"], documentTypes:["contrat"]',
    "",
    "SCHÉMA :",
    schema,
    "",
    "Champs par défaut si absents :",
    JSON.stringify(EMPTY_SMART_SEARCH_INTENT, null, 2),
    "",
    "REQUÊTE UTILISATEUR :",
    "<<<QUERY>>>",
    query.trim(),
    "<<<END>>>",
  ].join("\n");
}
