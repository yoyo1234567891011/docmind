import { buildSpecializedAnalysisPrompt } from "@/prompts/shared";
import type { CategoryPromptDefinition } from "@/prompts/types";

const label = "Impôts";
const focusPoints = [
  "Type d'impôt ou de formalité fiscale concernée",
  "Identifiant fiscal, période et année de référence",
  "Montants dus, déjà payés, restant à payer ou remboursement",
  "Dates limites de déclaration, paiement ou recours",
  "Motifs de redressement, pénalités ou majorations",
  "Pièces à fournir et démarches demandées par l'administration",
  "Conséquences en cas d'inaction ou de retard",
];

export const impotsPrompt: CategoryPromptDefinition = {
  id: "impots",
  label,
  focusPoints,
  buildPrompt(documentText) {
    return buildSpecializedAnalysisPrompt({
      categoryLabel: label,
      focusPoints,
      documentText,
    });
  },
};
