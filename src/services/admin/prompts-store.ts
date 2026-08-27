import { mkdir, readFile, writeFile } from "fs/promises";
import { randomUUID } from "crypto";

import { canUseLocalFilesystem } from "@/config/persistence";
import { ADMIN_DIR, ADMIN_PROMPTS_FILE } from "@/config/paths";
import { DEFAULT_ADMIN_PROMPTS } from "@/services/admin/default-prompts";
import { updateAdminConfig } from "@/services/admin/config-store";
import type {
  AdminPromptKey,
  AdminPromptVersion,
  AdminPromptsFile,
} from "@/types/admin";

/** FS local (dev) seulement — Vercel / persistent = mémoire + défauts. */
function adminFsEnabled(): boolean {
  return canUseLocalFilesystem();
}

async function ensureAdminDir(): Promise<void> {
  if (!adminFsEnabled()) return;
  await mkdir(ADMIN_DIR, { recursive: true });
}

let memoryPrompts: AdminPromptsFile | null = null;

function nextVersionNumber(
  versions: AdminPromptVersion[],
  key: AdminPromptKey,
): number {
  const max = versions
    .filter((v) => v.key === key)
    .reduce((acc, v) => Math.max(acc, v.version || 0), 0);
  return max + 1;
}

function normalizeVersion(
  raw: Partial<AdminPromptVersion> & {
    id: string;
    key: AdminPromptKey;
    label: string;
    content: string;
  },
  fallbackVersion: number,
): AdminPromptVersion {
  return {
    id: raw.id,
    key: raw.key,
    version: typeof raw.version === "number" ? raw.version : fallbackVersion,
    label: raw.label,
    content: raw.content,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    parentId: raw.parentId ?? null,
    note: raw.note,
  };
}

function normalizeFile(file: AdminPromptsFile): AdminPromptsFile {
  const byKey = new Map<AdminPromptKey, number>();
  const versions = file.versions.map((raw) => {
    const current = byKey.get(raw.key) ?? 0;
    const version =
      typeof raw.version === "number" && raw.version > 0
        ? raw.version
        : current + 1;
    byKey.set(raw.key, Math.max(byKey.get(raw.key) ?? 0, version));
    return normalizeVersion(raw, version);
  });
  return { versions };
}

function seedDefaults(): AdminPromptsFile {
  const now = new Date().toISOString();
  const versions: AdminPromptVersion[] = (
    Object.keys(DEFAULT_ADMIN_PROMPTS) as AdminPromptKey[]
  ).map((key) => ({
    id: randomUUID(),
    key,
    version: 1,
    label: `Défaut — ${key}`,
    content: DEFAULT_ADMIN_PROMPTS[key],
    createdAt: now,
    parentId: null,
    note: "Version initiale (immuable). Toute édition crée v2, v3…",
  }));
  return { versions };
}

export async function readAdminPrompts(): Promise<AdminPromptsFile> {
  if (memoryPrompts) return memoryPrompts;

  if (!adminFsEnabled()) {
    memoryPrompts = seedDefaults();
    return memoryPrompts;
  }

  await ensureAdminDir();
  try {
    const raw = await readFile(ADMIN_PROMPTS_FILE, "utf8");
    const parsed = JSON.parse(raw) as AdminPromptsFile;
    if (!parsed.versions?.length) {
      const seeded = seedDefaults();
      await writeFile(
        ADMIN_PROMPTS_FILE,
        JSON.stringify(seeded, null, 2),
        "utf8",
      );
      memoryPrompts = seeded;
      return seeded;
    }
    const normalized = normalizeFile(parsed);
    memoryPrompts = normalized;
    return normalized;
  } catch {
    const seeded = seedDefaults();
    await writeFile(ADMIN_PROMPTS_FILE, JSON.stringify(seeded, null, 2), "utf8").catch(
      () => undefined,
    );
    memoryPrompts = seeded;
    return seeded;
  }
}

export function getMemoryPrompts(): AdminPromptsFile | null {
  return memoryPrompts;
}

export async function saveAdminPrompts(
  file: AdminPromptsFile,
): Promise<AdminPromptsFile> {
  const normalized = normalizeFile(file);
  memoryPrompts = normalized;
  if (!adminFsEnabled()) return normalized;
  await ensureAdminDir();
  await writeFile(
    ADMIN_PROMPTS_FILE,
    JSON.stringify(normalized, null, 2),
    "utf8",
  );
  return normalized;
}

/**
 * Always creates a NEW immutable version (never overwrites an existing one).
 */
export async function createPromptVersion(input: {
  key: AdminPromptKey;
  label: string;
  content: string;
  note?: string;
  parentId?: string | null;
  /** If true (default), activates this version immediately */
  activate?: boolean;
}): Promise<AdminPromptVersion> {
  const file = await readAdminPrompts();
  const now = new Date().toISOString();
  const versionNumber = nextVersionNumber(file.versions, input.key);

  const created: AdminPromptVersion = {
    id: randomUUID(),
    key: input.key,
    version: versionNumber,
    label: input.label.trim() || `v${versionNumber}`,
    content: input.content,
    createdAt: now,
    parentId: input.parentId ?? null,
    note: input.note,
  };

  file.versions.unshift(created);
  await saveAdminPrompts(file);

  if (input.activate !== false) {
    await updateAdminConfig({
      activePrompts: { [input.key]: created.id },
    });
  }

  return created;
}

/** @deprecated Prefer createPromptVersion — kept for API compat, always creates new. */
export async function upsertPromptVersion(input: {
  id?: string;
  key: AdminPromptKey;
  label: string;
  content: string;
  note?: string;
}): Promise<AdminPromptVersion> {
  return createPromptVersion({
    key: input.key,
    label: input.label,
    content: input.content,
    note: input.note,
    parentId: input.id ?? null,
    activate: true,
  });
}

/**
 * One-click rollback: point active prompt at an existing immutable version.
 */
export async function rollbackToPromptVersion(
  versionId: string,
): Promise<AdminPromptVersion> {
  const version = await getPromptVersion(versionId);
  if (!version) {
    throw new Error("Version de prompt introuvable.");
  }
  await updateAdminConfig({
    activePrompts: { [version.key]: version.id },
  });
  return version;
}

export async function deletePromptVersion(id: string): Promise<void> {
  const file = await readAdminPrompts();
  file.versions = file.versions.filter((v) => v.id !== id);
  await saveAdminPrompts(file);
}

export async function getPromptVersion(
  id: string,
): Promise<AdminPromptVersion | null> {
  const file = memoryPrompts ?? (await readAdminPrompts());
  return file.versions.find((v) => v.id === id) ?? null;
}

export function listVersionsForKey(
  file: AdminPromptsFile,
  key: AdminPromptKey,
): AdminPromptVersion[] {
  return file.versions
    .filter((v) => v.key === key)
    .sort((a, b) => b.version - a.version);
}

export function renderPromptTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    return vars[key] ?? "";
  });
}
