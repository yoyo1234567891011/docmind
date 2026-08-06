import { randomUUID } from "crypto";
import path from "path";

import { userEntitiesFile, userMemoryDir } from "@/config/paths";
import {
  userFileEnsureDir,
  userFileRead,
  userFileWrite,
} from "@/lib/user-files";
import type { MemoryEntity, MemoryEntityKind } from "@/types/memory";
import {
  buildNormalizedEntityKey,
  normalizeEntityKey,
} from "@/services/memory/normalize";

async function ensureMemoryDir(userId: string): Promise<void> {
  await userFileEnsureDir(userMemoryDir(userId));
}

function parseJsonl(raw: string): MemoryEntity[] {
  const out: MemoryEntity[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as MemoryEntity);
    } catch {
      // skip corrupt line
    }
  }
  return out;
}

export async function listEntities(userId: string): Promise<MemoryEntity[]> {
  try {
    const raw = await userFileRead(userId, userEntitiesFile(userId));
    if (!raw) return [];
    return parseJsonl(raw).filter((e) => e.userId === userId);
  } catch {
    return [];
  }
}

async function writeAllEntities(
  userId: string,
  entities: MemoryEntity[],
): Promise<void> {
  await ensureMemoryDir(userId);
  const body =
    entities.map((e) => JSON.stringify(e)).join("\n") +
    (entities.length ? "\n" : "");
  await userFileWrite(userId, userEntitiesFile(userId), body);
}

function aliasMatch(entity: MemoryEntity, key: string): boolean {
  if (entity.normalizedKey === key) return true;
  const aliasKeys = entity.aliases.map((a) => buildNormalizedEntityKey(a));
  if (aliasKeys.includes(key)) return true;
  const base = key.split("|")[0] ?? key;
  if ((entity.normalizedKey.split("|")[0] ?? "") === base && base.length >= 4) {
    return true;
  }
  return entity.aliases.some(
    (a) => normalizeEntityKey(a) === normalizeEntityKey(base.replace(/-/g, " ")),
  );
}

export async function findEntityByKey(
  userId: string,
  normalizedKey: string,
): Promise<MemoryEntity | null> {
  const all = await listEntities(userId);
  return all.find((e) => aliasMatch(e, normalizedKey)) ?? null;
}

export interface UpsertEntityInput {
  kind: MemoryEntityKind;
  name: string;
  docId: string;
  roleHints?: string[];
  confidence?: number;
  seenAt?: string;
}

/**
 * Résolution : exact normalized_key → fuzzy alias → créer.
 */
export async function upsertEntity(
  userId: string,
  input: UpsertEntityInput,
): Promise<MemoryEntity> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Entity name required");
  }
  const normalizedKey = buildNormalizedEntityKey(name);
  const seenAt = input.seenAt ?? new Date().toISOString();
  const all = await listEntities(userId);
  const existing = all.find(
    (e) => e.kind === input.kind && aliasMatch(e, normalizedKey),
  );

  if (existing) {
    const aliases = new Set(existing.aliases);
    if (normalizeEntityKey(existing.canonicalName) !== normalizeEntityKey(name)) {
      aliases.add(name);
    }
    const roles = new Set([...(existing.roleHints ?? []), ...(input.roleHints ?? [])]);
    const docIds = new Set(existing.docIds);
    docIds.add(input.docId);
    const next: MemoryEntity = {
      ...existing,
      aliases: [...aliases],
      roleHints: [...roles],
      docIds: [...docIds],
      lastSeenAt: seenAt,
      confidence: Math.max(
        existing.confidence,
        input.confidence ?? existing.confidence,
      ),
    };
    const idx = all.findIndex((e) => e.id === existing.id);
    all[idx] = next;
    await writeAllEntities(userId, all);
    return next;
  }

  const created: MemoryEntity = {
    id: randomUUID(),
    userId,
    kind: input.kind,
    canonicalName: name,
    aliases: [],
    normalizedKey,
    roleHints: input.roleHints ?? [],
    docIds: [input.docId],
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
    confidence: input.confidence ?? 0.7,
  };
  all.push(created);
  await writeAllEntities(userId, all);
  return created;
}

export async function unlinkEntityDoc(
  userId: string,
  docId: string,
): Promise<void> {
  const all = await listEntities(userId);
  let dirty = false;
  const next = all
    .map((e) => {
      if (!e.docIds.includes(docId)) return e;
      dirty = true;
      return { ...e, docIds: e.docIds.filter((id) => id !== docId) };
    })
    .filter((e) => e.docIds.length > 0);
  if (dirty) await writeAllEntities(userId, next);
}

/** Path helper for tests / export. */
export function entitiesFilePath(userId: string): string {
  return userEntitiesFile(userId);
}

export function entitiesDirHint(userId: string): string {
  return path.dirname(userEntitiesFile(userId));
}
