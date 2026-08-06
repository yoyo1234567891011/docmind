/**
 * Compat layer — source de vérité : `src/config/docmind.ts`.
 */
export {
  ACTIVE_MODEL_PROFILE,
  MODEL_PROFILES,
  MODEL_PROFILE_IDS,
  getActiveModelProfile,
  getActiveModelProfileId as getActiveProfileIdFromConfig,
  resolveProfileChatModel,
  resolveProfileTemperature,
  resolveProfileMaxTokens,
  docmindConfig,
  type ModelProfileId,
  type ChatTaskId,
  type ModelProfile,
  type ModelProfileTaskOverride,
} from "@/config/docmind";

import {
  docmindConfig,
  type ModelProfile,
  type ModelProfileId,
} from "@/config/docmind";

export function getModelProfile(id: ModelProfileId): ModelProfile {
  return docmindConfig.ollama.profiles[id];
}
