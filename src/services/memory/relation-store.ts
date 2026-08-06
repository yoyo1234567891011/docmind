import path from "path";

import { userRelationsDir, userRelationsFile } from "@/config/paths";
import {
  userFileEnsureDir,
  userFileList,
  userFileRead,
  userFileUnlink,
  userFileWrite,
} from "@/lib/user-files";
import type { MemoryRelation } from "@/types/memory";

export async function listRelationsForDoc(
  userId: string,
  docId: string,
): Promise<MemoryRelation[]> {
  try {
    const raw = await userFileRead(userId, userRelationsFile(userId, docId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { relations?: MemoryRelation[] };
    return (parsed.relations ?? []).filter((r) => r.userId === userId);
  } catch {
    return [];
  }
}

export async function saveRelationsForDoc(
  userId: string,
  docId: string,
  relations: MemoryRelation[],
): Promise<void> {
  await userFileEnsureDir(userRelationsDir(userId));
  await userFileWrite(
    userId,
    userRelationsFile(userId, docId),
    JSON.stringify(
      {
        schema: "docmind-relations-v1",
        documentId: docId,
        updatedAt: new Date().toISOString(),
        relations,
      },
      null,
      2,
    ),
  );
}

/**
 * Upsert relation party_shared (idempotent par type + endpoints + entity).
 */
export async function upsertRelation(
  userId: string,
  docId: string,
  relation: MemoryRelation,
): Promise<MemoryRelation> {
  const existing = await listRelationsForDoc(userId, docId);
  const key = relationKey(relation);
  const idx = existing.findIndex((r) => relationKey(r) === key);
  if (idx >= 0) {
    const next = {
      ...existing[idx],
      ...relation,
      id: existing[idx].id,
      createdAt: existing[idx].createdAt,
      updatedAt: new Date().toISOString(),
    };
    existing[idx] = next;
    await saveRelationsForDoc(userId, docId, existing);
    return next;
  }
  existing.push(relation);
  await saveRelationsForDoc(userId, docId, existing);
  return relation;
}

function relationKey(r: MemoryRelation): string {
  const a = [r.fromDocId, r.toDocId].sort().join("|");
  const node =
    r.fromNode?.kind === "entity"
      ? r.fromNode.id
      : r.toNode?.kind === "entity"
        ? r.toNode.id
        : "";
  return `${r.type}:${a}:${node}`;
}

export async function deleteRelationsForDoc(
  userId: string,
  docId: string,
): Promise<void> {
  await userFileUnlink(userId, userRelationsFile(userId, docId));
}

export async function listAllRelations(
  userId: string,
): Promise<MemoryRelation[]> {
  try {
    const dir = userRelationsDir(userId);
    const files = await userFileList(userId, dir);
    const out: MemoryRelation[] = [];
    for (const file of files.filter((f) => f.endsWith(".json"))) {
      const docId = path.basename(file, ".json");
      out.push(...(await listRelationsForDoc(userId, docId)));
    }
    return out;
  } catch {
    return [];
  }
}
