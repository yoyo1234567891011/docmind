import { buildSpecializedAnalysisPrompt } from "@/prompts/shared";
import type { CategoryPromptDefinition } from "@/prompts/types";

const label = "Courrier administratif";
const focusPoints = [
  "Émetteur administratif et destinataire",
  "Objet de la demande, notification ou décision",
  "Références de dossier et fondement invoqué",
  "Délais de réponse, recours ou exécution",
  "Pièces demandées et formalités à accomplir",
  "Conséquences en cas d'absence de réponse",
  "Urgence, ton et caractère contraignant du courrier",
];

export const courrierAdministratifPrompt: CategoryPromptDefinition = {
  id: "courrier-administratif",
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
