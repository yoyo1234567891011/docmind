import { buildSpecializedAnalysisPrompt } from "@/prompts/shared";
import type { CategoryPromptDefinition } from "@/prompts/types";

const label = "Impôts";
const focusPoints = [
  "Type d'impôt ou de formalité fiscale concernée",
  "Identifiant fiscal, période et année de référence",
  "Montant dû / à prélever / restant à payer (priorité absolue) — titres du type « Taxe foncière : 1 178 € » ; ignorer totaux nationaux, statistiques et chiffres hors sujet",
  "Dates de prélèvement, limite de paiement ou d’opposition (ex. « Prélèvement le 27/10/2025 », « Opposition possible avant le 01/10/2025 »)",
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
