import { buildSpecializedAnalysisPrompt } from "@/prompts/shared";
import type { CategoryPromptDefinition } from "@/prompts/types";

const label = "Banque";
const focusPoints = [
  "Nature du document bancaire (relevé, offre, avenant, mise en demeure)",
  "Identité du titulaire, IBAN/BIC et établissement concerné",
  "Mouvements, soldes, découverts et frais bancaires",
  "Taux d'intérêt, TAEG, échéances et conditions de crédit",
  "Garanties, cautions et engagements financiers",
  "Dates limites de réponse, opposition ou régularisation",
  "Anomalies, prélèvements contestables ou alertes de risque",
];

export const banquePrompt: CategoryPromptDefinition = {
  id: "banque",
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
