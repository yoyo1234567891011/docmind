import {
  readAdminConfig,
  getMemoryAdminConfig,
} from "@/services/admin/config-store";
import {
  getPromptVersion,
  getMemoryPrompts,
  readAdminPrompts,
  renderPromptTemplate,
} from "@/services/admin/prompts-store";
import type {
  AdminPromptKey,
  PromptUsageEntry,
  PromptUsageSnapshot,
} from "@/types/admin";

const PROMPT_KEYS: AdminPromptKey[] = [
  "classification",
  "analysis",
  "reply",
  "searchIntent",
];

/**
 * Returns active admin prompt template for a key, or null to use code builders.
 */
export async function getActivePromptTemplate(
  key: AdminPromptKey,
): Promise<string | null> {
  const config = getMemoryAdminConfig() ?? (await readAdminConfig());
  const versionId = config.activePrompts[key];
  if (!versionId) return null;

  if (!getMemoryPrompts()) {
    await readAdminPrompts();
  }

  const version = await getPromptVersion(versionId);
  return version?.content ?? null;
}

/** Sync-friendly: uses memory cache only (warmed by admin/API bootstrap). */
export function getActivePromptTemplateSync(
  key: AdminPromptKey,
): string | null {
  const config = getMemoryAdminConfig();
  if (!config) return null;
  const versionId = config.activePrompts[key];
  if (!versionId) return null;
  const prompts = getMemoryPrompts();
  const version = prompts?.versions.find((v) => v.id === versionId);
  return version?.content ?? null;
}

export function applyPromptTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return renderPromptTemplate(template, vars);
}

export async function ensureAdminRuntimeLoaded(): Promise<void> {
  await readAdminConfig();
  await readAdminPrompts();
}

/**
 * Snapshot of prompt revisions used for the current analysis/eval run.
 */
export async function getPromptUsageSnapshot(): Promise<PromptUsageSnapshot> {
  await ensureAdminRuntimeLoaded();
  const config = getMemoryAdminConfig() ?? (await readAdminConfig());
  const prompts = getMemoryPrompts() ?? (await readAdminPrompts());

  return PROMPT_KEYS.map((key): PromptUsageEntry => {
    const versionId = config.activePrompts[key];
    if (!versionId) {
      return {
        key,
        source: "code",
        versionId: null,
        version: null,
        label: `code/${key}`,
      };
    }
    const version = prompts.versions.find((v) => v.id === versionId);
    if (!version) {
      return {
        key,
        source: "code",
        versionId: null,
        version: null,
        label: `code/${key} (version manquante)`,
      };
    }
    return {
      key,
      source: "admin",
      versionId: version.id,
      version: version.version,
      label: `v${version.version} — ${version.label}`,
    };
  });
}
