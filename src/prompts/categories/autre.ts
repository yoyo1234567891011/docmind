import { buildSpecializedAnalysisPrompt } from "@/prompts/shared";
import type { CategoryPromptDefinition } from "@/prompts/types";

const label = "Autre";
const focusPoints = [
  "Nature probable du document et objectif principal",
  "Parties, destinataires et contexte identifiable",
  "Informations clés (dates, montants, obligations, décisions)",
  "Points ambigus, incomplets ou contradictoires",
  "Risques pratiques ou juridiques détectables",
  "Actions prioritaires à entreprendre",
  "Éléments manquants utiles à une analyse plus fine",
];

export const autrePrompt: CategoryPromptDefinition = {
  id: "autre",
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
