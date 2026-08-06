import type { DocumentCategory } from "@/types";

export interface CategoryPromptDefinition {
  id: DocumentCategory;
  label: string;
  focusPoints: string[];
  buildPrompt: (documentText: string) => string;
}
