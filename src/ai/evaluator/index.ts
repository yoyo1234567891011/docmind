/**
 * Evaluator façade — comparison + reporting + embedding warm-up.
 * Scripts (`npm run evaluate`) should import from here.
 */
export {
  averageScore,
  compareAnalysis,
  toPredictedShape,
  normalizeDeadline,
} from "@/ai/comparison";
export { writeHtmlReport } from "@/ai/evaluator/report";
export { writeAgentHtmlReport } from "@/ai/evaluator/agent-report";
export {
  scoreAgents,
  averageAgentScore,
  averageAgentScoresById,
} from "@/ai/evaluator/agent-scores";
export { ensureEmbeddingModel } from "@/ai/models";
