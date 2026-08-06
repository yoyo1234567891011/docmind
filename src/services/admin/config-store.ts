import { mkdir, readFile, writeFile } from "fs/promises";

import {
  buildTaskConfigFromActiveProfile,
  getActiveProfileId,
  getDefaultChatModel,
  getEmbedModel,
  getOllamaBaseUrl,
  getTaskConfig,
  type AiTask,
} from "@/ai/models/config";
import {
  assertSafeOllamaBaseUrl,
  normalizeOllamaBaseUrl,
} from "@/ai/models/ollama-http";
import {
  getModelProfile,
  MODEL_PROFILES,
  resolveProfileChatModel,
  resolveProfileMaxTokens,
  resolveProfileTemperature,
  type ModelProfileId,
} from "@/config/ollama-models";
import { docmindConfig } from "@/config/docmind";
import { ADMIN_CONFIG_FILE, ADMIN_DIR } from "@/config/paths";
import type {
  AdminPromptKey,
  AdminRuntimeConfig,
  AdminTaskModelConfig,
} from "@/types/admin";

const CHAT_TASKS = [
  "classify",
  "analyze",
  "reply",
  "searchIntent",
] as const satisfies ReadonlyArray<Exclude<AiTask, "embed">>;

const PROMPT_KEYS: AdminPromptKey[] = [
  "classification",
  "analysis",
  "reply",
  "searchIntent",
];

function tasksFromCodeProfile(): AdminRuntimeConfig["tasks"] {
  const built = buildTaskConfigFromActiveProfile();
  const tasks = {} as AdminRuntimeConfig["tasks"];
  for (const task of CHAT_TASKS) {
    tasks[task] = {
      model: built[task].model,
      temperature: built[task].temperature,
      maxTokens: built[task].maxTokens,
    };
  }
  return tasks;
}

function defaultConfig(): AdminRuntimeConfig {
  return {
    ollamaBaseUrl: getOllamaBaseUrl(),
    tasks: tasksFromCodeProfile(),
    embedModel: getEmbedModel(),
    activePrompts: {
      classification: docmindConfig.prompts.activeByKey.classification,
      analysis: docmindConfig.prompts.activeByKey.analysis,
      reply: docmindConfig.prompts.activeByKey.reply,
      searchIntent: docmindConfig.prompts.activeByKey.searchIntent,
    },
    profileId: getActiveProfileId(),
    updatedAt: new Date().toISOString(),
  };
}

async function ensureAdminDir(): Promise<void> {
  await mkdir(ADMIN_DIR, { recursive: true });
}

let memoryConfig: AdminRuntimeConfig | null = null; // reset on HMR so disk config wins

export function getMemoryAdminConfig(): AdminRuntimeConfig | null {
  return memoryConfig;
}

/**
 * If ACTIVE_MODEL_PROFILE (code/env) changed, refresh task models from that profile
 * while preserving prompt activations and Ollama URL.
 */
function syncProfileIfNeeded(
  config: AdminRuntimeConfig,
): { config: AdminRuntimeConfig; dirty: boolean } {
  const activeProfileId = getActiveProfileId();
  if (config.profileId === activeProfileId) {
    return { config, dirty: false };
  }

  return {
    dirty: true,
    config: {
      ...config,
      profileId: activeProfileId,
      tasks: tasksFromCodeProfile(),
      embedModel: getEmbedModel(),
      updatedAt: new Date().toISOString(),
    },
  };
}

export async function readAdminConfig(): Promise<AdminRuntimeConfig> {
  await ensureAdminDir();
  try {
    const raw = await readFile(ADMIN_CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<AdminRuntimeConfig>;
    const base = defaultConfig();
    let merged: AdminRuntimeConfig = {
      ...base,
      ...parsed,
      tasks: { ...base.tasks, ...(parsed.tasks ?? {}) },
      activePrompts: {
        ...base.activePrompts,
        ...(parsed.activePrompts ?? {}),
      },
      profileId: parsed.profileId,
      updatedAt: parsed.updatedAt ?? base.updatedAt,
    };

    const synced = syncProfileIfNeeded(merged);
    merged = synced.config;

    try {
      merged.ollamaBaseUrl = assertSafeOllamaBaseUrl(merged.ollamaBaseUrl);
    } catch {
      merged.ollamaBaseUrl = normalizeOllamaBaseUrl(getOllamaBaseUrl());
      synced.dirty = true;
    }

    if (synced.dirty) {
      await writeFile(ADMIN_CONFIG_FILE, JSON.stringify(merged, null, 2), "utf8");
    }

    memoryConfig = merged;
    return merged;
  } catch {
    const created = defaultConfig();
    await writeFile(ADMIN_CONFIG_FILE, JSON.stringify(created, null, 2), "utf8");
    memoryConfig = created;
    return created;
  }
}

export async function writeAdminConfig(
  next: AdminRuntimeConfig,
): Promise<AdminRuntimeConfig> {
  await ensureAdminDir();
  const payload: AdminRuntimeConfig = {
    ...next,
    profileId: next.profileId ?? getActiveProfileId(),
    updatedAt: new Date().toISOString(),
  };
  await writeFile(ADMIN_CONFIG_FILE, JSON.stringify(payload, null, 2), "utf8");
  memoryConfig = payload;
  return payload;
}

export async function updateAdminConfig(
  patch: Partial<
    Omit<AdminRuntimeConfig, "tasks" | "activePrompts">
  > & {
    tasks?: Partial<
      Record<Exclude<AiTask, "embed">, Partial<AdminTaskModelConfig>>
    >;
    activePrompts?: Partial<Record<AdminPromptKey, string | null>>;
  },
): Promise<AdminRuntimeConfig> {
  const current = await readAdminConfig();
  const tasks = { ...current.tasks };
  if (patch.tasks) {
    for (const task of CHAT_TASKS) {
      if (patch.tasks[task]) {
        tasks[task] = {
          ...tasks[task],
          ...patch.tasks[task],
        };
      }
    }
  }

  return writeAdminConfig({
    ollamaBaseUrl: assertSafeOllamaBaseUrl(
      patch.ollamaBaseUrl ?? current.ollamaBaseUrl,
    ),
    embedModel: patch.embedModel ?? current.embedModel,
    tasks,
    activePrompts: {
      ...current.activePrompts,
      ...(patch.activePrompts ?? {}),
    },
    profileId:
      typeof patch.profileId === "string"
        ? patch.profileId
        : current.profileId,
    updatedAt: current.updatedAt,
  });
}

/**
 * Apply a named code profile to Admin runtime (models + temperatures).
 */
export async function applyModelProfile(
  profileId: ModelProfileId,
): Promise<AdminRuntimeConfig> {
  if (!(profileId in MODEL_PROFILES)) {
    throw new Error(`Profil inconnu: ${profileId}`);
  }

  const profile = getModelProfile(profileId);
  const tasks = {} as AdminRuntimeConfig["tasks"];
  const defaults: Record<Exclude<AiTask, "embed">, number> = {
    classify: 0,
    analyze: 0,
    reply: 0.3,
    searchIntent: 0,
  };

  for (const task of CHAT_TASKS) {
    tasks[task] = {
      model: resolveProfileChatModel(profile, task),
      temperature: resolveProfileTemperature(profile, task),
      maxTokens: resolveProfileMaxTokens(profile, task),
    };
  }

  const current = await readAdminConfig();
  return writeAdminConfig({
    ...current,
    profileId,
    tasks,
    embedModel: profile.embed,
  });
}

export async function resolveTaskConfig(
  task: AiTask,
): Promise<AdminTaskModelConfig & { ollamaBaseUrl: string }> {
  const config = memoryConfig ?? (await readAdminConfig());
  if (task === "embed") {
    return {
      model: config.embedModel || getEmbedModel(),
      temperature: 0,
      maxTokens: 0,
      ollamaBaseUrl: normalizeOllamaBaseUrl(
        config.ollamaBaseUrl || getOllamaBaseUrl(),
      ),
    };
  }
  const taskConfig = config.tasks[task];
  const code = getTaskConfig(task);
  return {
    model: taskConfig?.model || getDefaultChatModel(),
    temperature: taskConfig?.temperature ?? code.temperature,
    maxTokens: taskConfig?.maxTokens ?? code.maxTokens,
    ollamaBaseUrl: normalizeOllamaBaseUrl(
      config.ollamaBaseUrl || getOllamaBaseUrl(),
    ),
  };
}

export { CHAT_TASKS, PROMPT_KEYS };
