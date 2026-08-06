/**
 * DocMind AI layer — modular, independently swappable pieces.
 *
 * | Module            | Change when you want to…                    |
 * |-------------------|---------------------------------------------|
 * | prompts           | Edit prompt text / category focus           |
 * | models            | Change Ollama model or temperature (config) |
 * | extraction        | Tweak regex entity extractors               |
 * | validation        | Change JSON parsing / field guards          |
 * | post-processing   | Change merge LLM + extraction               |
 * | scoring           | Change risk weights / patterns              |
 * | comparison        | Change eval field scoring                   |
 * | evaluator         | Change reports / eval orchestration helpers |
 * | pipelines         | Change step order only                      |
 * | agents            | Agents spécialisés (classify→verify)        |
 */
export * as prompts from "@/ai/prompts";
export * as models from "@/ai/models";
export * as extraction from "@/ai/extraction";
export * as validation from "@/ai/validation";
export * as postProcessing from "@/ai/post-processing";
export * as scoring from "@/ai/scoring";
export * as comparison from "@/ai/comparison";
export * as evaluator from "@/ai/evaluator";
export * as pipelines from "@/ai/pipelines";
export * as agents from "@/ai/agents";

export {
  analyzeDocumentText,
  classifyDocumentText,
  generateReadyReply,
} from "@/ai/pipelines";
