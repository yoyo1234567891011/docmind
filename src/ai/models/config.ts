/**
 * Runtime model config — derived from `src/config/docmind.ts` only.
 */

import {
  docmindConfig,
  getActiveModelProfile,
  getActiveModelProfileId,
  resolveProfileChatModel,
  resolveProfileMaxTokens,
  resolveProfileTemperature,
  type ChatTaskId,
  type ModelProfileId,
  MODEL_PROFILE_IDS,
  MODEL_PROFILES,
  ACTIVE_MODEL_PROFILE,
} from "@/config/docmind";

export type AiTask =
  | "classify"
  | "analyze"
  | "reply"
  | "searchIntent"
  | "embed";

export interface AiTaskConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

function envOr(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

export function getOllamaBaseUrl(): string {
  const raw = envOr(
    "OLLAMA_BASE_URL",
    docmindConfig.ollama.baseUrl,
  ).replace(/\/$/, "");
  // Windows: localhost → ::1 alors qu'Ollama écoute en IPv4
  return raw
    .replace(/^http:\/\/localhost(?=[:/]|$)/i, "http://127.0.0.1")
    .replace(/^https:\/\/localhost(?=[:/]|$)/i, "https://127.0.0.1");
}

export function getActiveProfileId(): ModelProfileId {
  return getActiveModelProfileId();
}

export function getActiveProfile() {
  return getActiveModelProfile();
}

export function getDefaultChatModel(): string {
  const profile = getActiveModelProfile();
  return envOr("OLLAMA_MODEL", profile.chat);
}

export function getEmbedModel(): string {
  const profile = getActiveModelProfile();
  return envOr("OLLAMA_EMBED_MODEL", profile.embed);
}

function chatModelForTask(task: ChatTaskId): string {
  const profile = getActiveModelProfile();
  const fromProfile = resolveProfileChatModel(profile, task);
  const envKey =
    task === "classify"
      ? "OLLAMA_MODEL_CLASSIFY"
      : task === "analyze"
        ? "OLLAMA_MODEL_ANALYZE"
        : task === "reply"
          ? "OLLAMA_MODEL_REPLY"
          : "OLLAMA_MODEL_SEARCH";
  return envOr(envKey, envOr("OLLAMA_MODEL", fromProfile));
}

export function buildTaskConfigFromActiveProfile(): Record<AiTask, AiTaskConfig> {
  const profile = getActiveModelProfile();
  const task = (id: ChatTaskId): AiTaskConfig => ({
    model: chatModelForTask(id),
    temperature: resolveProfileTemperature(profile, id),
    maxTokens: resolveProfileMaxTokens(profile, id),
  });

  return {
    classify: task("classify"),
    analyze: task("analyze"),
    reply: task("reply"),
    searchIntent: task("searchIntent"),
    embed: {
      model: getEmbedModel(),
      temperature: 0,
      maxTokens: 0,
    },
  };
}

export const AI_TASK_CONFIG: Record<AiTask, AiTaskConfig> =
  buildTaskConfigFromActiveProfile();

export function getTaskConfig(task: AiTask): AiTaskConfig {
  return buildTaskConfigFromActiveProfile()[task];
}

export {
  ACTIVE_MODEL_PROFILE,
  MODEL_PROFILES,
  MODEL_PROFILE_IDS,
  getActiveModelProfile,
  type ModelProfileId,
};
