import { buildSpecializedAnalysisPrompt } from "@/prompts/shared";
import type { CategoryPromptDefinition } from "@/prompts/types";

const label = "Conditions générales";
const focusPoints = [
  "Périmètre d'application et parties concernées",
  "Obligations du client/utilisateur et du prestataire",
  "Prix, frais cachés, augmentation de tarif, renouvellement tacite et résiliation",
  "Durée d'engagement et conditions de sortie",
  "Limitation de responsabilité et exclusions de garantie",
  "Clauses abusives, déséquilibrées ou peu lisibles",
  "Pénalités, sanctions, litiges et modalités de modification des CG",
];

export const conditionsGeneralesPrompt: CategoryPromptDefinition = {
  id: "conditions-generales",
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
