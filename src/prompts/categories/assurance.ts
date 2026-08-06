import { buildSpecializedAnalysisPrompt } from "@/prompts/shared";
import type { CategoryPromptDefinition } from "@/prompts/types";

const label = "Assurance";
const focusPoints = [
  "Type de contrat d'assurance et bien ou personne couverte",
  "Assureur, assuré, bénéficiaires et intermédiaire éventuel",
  "Garanties incluses, exclusions, franchises et clauses déséquilibrées",
  "Montant des primes, frais annexes, indexation et augmentation de tarif",
  "Période de couverture, engagement, tacite reconduction et résiliation",
  "Obligations de déclaration, délais de sinistre et pénalités",
  "Sanctions, déchéance de garantie et plafonds d'indemnisation",
];

export const assurancePrompt: CategoryPromptDefinition = {
  id: "assurance",
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
