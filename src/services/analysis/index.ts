/**
 * Compatibility shim — prefer `@/ai/pipelines` or `@/ai`.
 */
export { analyzeDocumentText } from "@/ai/pipelines/analyze";
export { classifyDocumentText } from "@/ai/pipelines/classify";
export { parseDocumentAnalysisResponse } from "@/ai/validation";
export { parseClassificationResponse } from "@/ai/validation";
export { enrichAnalysisWithExtractedEntities } from "@/ai/post-processing";
