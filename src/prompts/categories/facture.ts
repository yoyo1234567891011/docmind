import { buildSpecializedAnalysisPrompt } from "@/prompts/shared";
import type { CategoryPromptDefinition } from "@/prompts/types";

const label = "Facture";
const focusPoints = [
  "Émetteur, destinataire et mentions légales obligatoires",
  "Numéro de facture, date d'émission et date d'échéance",
  "Détail des prestations ou produits facturés",
  "Montants HT, TVA, TTC et éventuelles remises",
  "Coordonnées de paiement et références bancaires",
  "Pénalités de retard, escompte et conditions de règlement",
  "Incohérences de montants, doublons ou anomalies apparentes",
];

export const facturePrompt: CategoryPromptDefinition = {
  id: "facture",
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
