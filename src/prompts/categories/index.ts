import { assurancePrompt } from "@/prompts/categories/assurance";
import { autrePrompt } from "@/prompts/categories/autre";
import { bailPrompt } from "@/prompts/categories/bail";
import { banquePrompt } from "@/prompts/categories/banque";
import { conditionsGeneralesPrompt } from "@/prompts/categories/conditions-generales";
import { contratPrompt } from "@/prompts/categories/contrat";
import { contratDeTravailPrompt } from "@/prompts/categories/contrat-de-travail";
import { courrierAdministratifPrompt } from "@/prompts/categories/courrier-administratif";
import { facturePrompt } from "@/prompts/categories/facture";
import { impotsPrompt } from "@/prompts/categories/impots";
import type { CategoryPromptDefinition } from "@/prompts/types";
import type { DocumentCategory } from "@/types";

export const categoryPromptRegistry: Record<
  DocumentCategory,
  CategoryPromptDefinition
> = {
  contrat: contratPrompt,
  facture: facturePrompt,
  assurance: assurancePrompt,
  banque: banquePrompt,
  impots: impotsPrompt,
  bail: bailPrompt,
  "courrier-administratif": courrierAdministratifPrompt,
  "contrat-de-travail": contratDeTravailPrompt,
  "conditions-generales": conditionsGeneralesPrompt,
  autre: autrePrompt,
};

export function getCategoryPrompt(
  category: DocumentCategory,
): CategoryPromptDefinition {
  return categoryPromptRegistry[category];
}

export function buildCategoryAnalysisPrompt(
  category: DocumentCategory,
  documentText: string,
): string {
  return getCategoryPrompt(category).buildPrompt(documentText);
}
