import path from "path";

import { userMemoryIndexesDir } from "@/config/paths";
import {
  userFileEnsureDir,
  userFileRead,
  userFileWrite,
} from "@/lib/user-files";

/**
 * Cache de paires rejetées (user_dismissed) — ne plus reproposer.
 * Clé : docIds triés join "|" .
 */

type NegativeMap = Record<
  string,
  { dismissedAt: string; reason?: string }
>;

function filePath(userId: string): string {
  return path.join(userMemoryIndexesDir(userId), "negative_edges.json");
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

async function readMap(userId: string): Promise<NegativeMap> {
  try {
    const raw = await userFileRead(userId, filePath(userId));
    if (!raw) return {};
    return JSON.parse(raw) as NegativeMap;
  } catch {
    return {};
  }
}

async function writeMap(userId: string, map: NegativeMap): Promise<void> {
  await userFileEnsureDir(userMemoryIndexesDir(userId));
  await userFileWrite(userId, filePath(userId), JSON.stringify(map, null, 2));
}

export async function isNegativeEdge(
  userId: string,
  docA: string,
  docB: string,
): Promise<boolean> {
  const map = await readMap(userId);
  return Boolean(map[pairKey(docA, docB)]);
}

export async function addNegativeEdge(
  userId: string,
  docA: string,
  docB: string,
  reason = "user_dismissed",
): Promise<void> {
  const map = await readMap(userId);
  map[pairKey(docA, docB)] = {
    dismissedAt: new Date().toISOString(),
    reason,
  };
  await writeMap(userId, map);
}

export async function removeNegativeEdge(
  userId: string,
  docA: string,
  docB: string,
): Promise<void> {
  const map = await readMap(userId);
  delete map[pairKey(docA, docB)];
  await writeMap(userId, map);
}

export async function listNegativeEdgeKeys(
  userId: string,
): Promise<string[]> {
  return Object.keys(await readMap(userId));
}

/** Retire toutes les paires impliquant documentId. */
export async function removeNegativeEdgesForDoc(
  userId: string,
  documentId: string,
): Promise<void> {
  const map = await readMap(userId);
  let dirty = false;
  for (const key of Object.keys(map)) {
    const [a, b] = key.split("|");
    if (a === documentId || b === documentId) {
      delete map[key];
      dirty = true;
    }
  }
  if (dirty) await writeMap(userId, map);
}
