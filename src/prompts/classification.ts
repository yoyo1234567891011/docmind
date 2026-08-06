import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  type DocumentCategory,
} from "@/types";
import {
  applyPromptTemplate,
  getActivePromptTemplateSync,
} from "@/services/admin/runtime";

const CLASSIFICATION_SCHEMA = {
  category: "autre",
  confidence: 0,
};

/**
 * Prompt court — utilisé seulement si l'heuristique locale échoue.
 */
export function buildClassificationPrompt(documentText: string): string {
  const categoriesList = DOCUMENT_CATEGORIES.map(
    (category) => `${category}=${DOCUMENT_CATEGORY_LABELS[category]}`,
  ).join(", ");
  const schema = JSON.stringify(CLASSIFICATION_SCHEMA);
  const vars = {
    categoriesList,
    schema,
    documentText: documentText.trim(),
  };

  const override = getActivePromptTemplateSync("classification");
  if (override) {
    return applyPromptTemplate(override, vars);
  }

  return [
    "Classifie ce document. JSON uniquement.",
    `Catégories: ${categoriesList}`,
    `Schéma: ${schema}`,
    "<<<DOCUMENT>>>",
    documentText.trim(),
    "<<<FIN>>>",
  ].join("\n");
}

export function isDocumentCategory(value: string): value is DocumentCategory {
  return (DOCUMENT_CATEGORIES as readonly string[]).includes(value);
}
