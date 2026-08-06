import { buildSpecializedAnalysisPrompt } from "@/prompts/shared";
import type { CategoryPromptDefinition } from "@/prompts/types";

const label = "Contrat";
const focusPoints = [
  "Identité des parties contractantes et qualité juridique",
  "Objet du contrat et prestations prévues",
  "Durée, engagement minimal, reconduction tacite et résiliation",
  "Obligations principales de chaque partie",
  "Prix, révision/augmentation de tarif, frais annexes et pénalités",
  "Clauses abusives, limitatives de responsabilité et garanties",
  "Sanctions, mise en demeure et droit applicable",
];

export const contratPrompt: CategoryPromptDefinition = {
  id: "contrat",
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
