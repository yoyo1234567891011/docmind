export {
  AI_TASK_CONFIG,
  buildTaskConfigFromActiveProfile,
  getActiveProfile,
  getActiveProfileId,
  getDefaultChatModel,
  getEmbedModel,
  getOllamaBaseUrl,
  getTaskConfig,
  type AiTask,
  type AiTaskConfig,
  ACTIVE_MODEL_PROFILE,
  MODEL_PROFILES,
  MODEL_PROFILE_IDS,
  type ModelProfileId,
} from "@/ai/models/config";
export {
  generateForTask,
  generateWithOllama,
  sendTextToOllama,
  listOllamaModels,
  getOllamaGenerateLockState,
} from "@/ai/models/client";
export { withOllamaGenerateLock } from "@/ai/models/generate-lock";
export { isAbortError } from "@/ai/models/ollama-http";
export type {
  OllamaGenerateOptions,
  OllamaGenerateRequest,
  OllamaGenerateResponse,
  OllamaGenerateResult,
} from "@/ai/models/types";
export {
  cosineSimilarity,
  embedText,
  ensureEmbeddingModel,
  semanticSimilarity,
} from "@/ai/models/embeddings";
