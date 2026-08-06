import { isDocumentCategory } from "@/ai/prompts";
import { tryParseJsonObject } from "@/ai/validation/json";
import { docmindConfig } from "@/config/docmind";
import {
  DOCUMENT_CATEGORY_LABELS,
  type DocumentClassification,
} from "@/types";

interface RawClassification {
  category?: unknown;
  confidence?: unknown;
  label?: unknown;
}

function fallbackClassification(): DocumentClassification {
  const category = docmindConfig.categories.fallback;
  return {
    category,
    label: DOCUMENT_CATEGORY_LABELS[category],
    confidence: 0,
  };
}

/**
 * Never throws — a bad model reply falls back to "autre"
 * so the analysis pipeline can continue.
 */
export function parseClassificationResponse(
  raw: string,
): DocumentClassification {
  const parsed = tryParseJsonObject<RawClassification>(raw);
  if (!parsed) return fallbackClassification();

  const categoryValue =
    typeof parsed.category === "string" ? parsed.category.trim() : "";

  let category = isDocumentCategory(categoryValue)
    ? categoryValue
    : docmindConfig.categories.fallback;

  // Mistral renvoie parfois le label FR au lieu de l'id
  if (!isDocumentCategory(categoryValue) && typeof parsed.label === "string") {
    const label = parsed.label.toLowerCase();
    const matched = (
      Object.entries(DOCUMENT_CATEGORY_LABELS) as Array<
        [keyof typeof DOCUMENT_CATEGORY_LABELS, string]
      >
    ).find(([, fr]) => fr.toLowerCase() === label);
    if (matched) category = matched[0];
  }

  // Heuristique légère sur le texte brut de réponse
  if (category === docmindConfig.categories.fallback) {
    const lower = raw.toLowerCase();
    if (lower.includes("banque") || lower.includes('"bank')) category = "banque";
    else if (lower.includes("assurance")) category = "assurance";
    else if (lower.includes("impot") || lower.includes("impôt"))
      category = "impots";
    else if (lower.includes("bail") || lower.includes("location"))
      category = "bail";
    else if (lower.includes("facture")) category = "facture";
    else if (lower.includes("travail") || lower.includes("cdi"))
      category = "contrat-de-travail";
  }

  const confidence =
    typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
      ? Math.min(1, Math.max(0, parsed.confidence))
      : docmindConfig.thresholds.classificationDefaultConfidence;

  if (
    confidence < docmindConfig.thresholds.classificationMinConfidence &&
    category !== docmindConfig.categories.fallback
  ) {
    // garder la catégorie détectée même si confiance basse — mieux que "autre"
  }

  return {
    category,
    label: DOCUMENT_CATEGORY_LABELS[category],
    confidence,
  };
}
