/**
 * Prompts module — single import surface.
 * Edit prompt strings only under `src/prompts/` ; consume via `@/ai/prompts`.
 */
export { buildSpecializedAnalysisPrompt } from "@/prompts/shared";
export type { SpecializedPromptInput } from "@/prompts/shared";
export type { CategoryPromptDefinition } from "@/prompts/types";
export {
  buildClassificationPrompt,
  isDocumentCategory,
} from "@/prompts/classification";
export {
  categoryPromptRegistry,
  getCategoryPrompt,
  buildCategoryAnalysisPrompt,
} from "@/prompts/categories";
export { buildReadyReplyPrompt } from "@/prompts/reply";
export { buildSmartSearchIntentPrompt } from "@/prompts/search";
