import {
  DOCUMENT_CATEGORY_IDS,
  docmindConfig,
  type DocumentCategoryId,
} from "@/config/docmind";

export const DOCUMENT_CATEGORIES = DOCUMENT_CATEGORY_IDS;

export type DocumentCategory = DocumentCategoryId;

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  ...docmindConfig.categories.labels,
};

export interface DocumentClassification {
  category: DocumentCategory;
  label: string;
  confidence: number;
}

export function isConfiguredDocumentCategory(
  value: string,
): value is DocumentCategory {
  return (DOCUMENT_CATEGORY_IDS as readonly string[]).includes(value);
}
