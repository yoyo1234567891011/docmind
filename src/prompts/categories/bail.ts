import { buildSpecializedAnalysisPrompt } from "@/prompts/shared";
import type { CategoryPromptDefinition } from "@/prompts/types";

const label = "Bail";
const focusPoints = [
  "Type de bail (habitation, commercial, professionnel) et parties",
  "Description du bien loué et destination autorisée",
  "Durée, engagement, renouvellement tacite et congé/résiliation",
  "Loyer, charges, dépôt de garantie, révision et augmentation de tarif",
  "Obligations importantes du bailleur et du locataire",
  "Délais, préavis, pénalités et sanctions",
  "Clauses abusives, interdictions, sous-location et litiges potentiels",
];

export const bailPrompt: CategoryPromptDefinition = {
  id: "bail",
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
