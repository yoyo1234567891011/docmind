import { buildSpecializedAnalysisPrompt } from "@/prompts/shared";
import type { CategoryPromptDefinition } from "@/prompts/types";

const label = "Contrat de travail";
const focusPoints = [
  "Employeur, salarié et type de contrat (CDI, CDD, alternance, etc.)",
  "Poste, qualification, lieu de travail et durée du travail",
  "Rémunération, primes, avantages et périodicité de paiement",
  "Période d'essai, durée et conditions de renouvellement",
  "Clauses de non-concurrence, mobilité, exclusivité ou confidentialité",
  "Congés, préavis, rupture et motifs de fin de contrat",
  "Convention collective applicable et points potentiellement déséquilibrés",
];

export const contratDeTravailPrompt: CategoryPromptDefinition = {
  id: "contrat-de-travail",
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
