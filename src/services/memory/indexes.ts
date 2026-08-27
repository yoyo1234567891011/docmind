import path from "path";

import { userMemoryIndexesDir } from "@/config/paths";
import {
  userFileEnsureDir,
  userFileRead,
  userFileWrite,
} from "@/lib/user-files";
import { simhashBands } from "@/services/memory/simhash";

/**
 * Index légers P0/P1 — mises à jour incrémentales (nouveau doc seulement).
 */

type StringListMap = Record<string, string[]>;

async function readMap(userId: string, name: string): Promise<StringListMap> {
  try {
    const file = path.join(userMemoryIndexesDir(userId), `${name}.json`);
    const raw = await userFileRead(userId, file);
    if (!raw) return {};
    return JSON.parse(raw) as StringListMap;
  } catch {
    return {};
  }
}

async function writeMap(
  userId: string,
  name: string,
  map: StringListMap,
): Promise<void> {
  await userFileEnsureDir(userMemoryIndexesDir(userId));
  const file = path.join(userMemoryIndexesDir(userId), `${name}.json`);
  await userFileWrite(userId, file, JSON.stringify(map, null, 2));
}

function addToMap(map: StringListMap, key: string, value: string): void {
  const list = new Set(map[key] ?? []);
  list.add(value);
  map[key] = [...list];
}

function removeFromMap(map: StringListMap, key: string, value: string): void {
  if (!map[key]) return;
  map[key] = map[key].filter((v) => v !== value);
  if (map[key].length === 0) delete map[key];
}

export async function indexEntityDoc(
  userId: string,
  entityId: string,
  docId: string,
): Promise<void> {
  const map = await readMap(userId, "by_entity");
  addToMap(map, entityId, docId);
  await writeMap(userId, "by_entity", map);
}

export async function unindexEntityDoc(
  userId: string,
  entityId: string,
  docId: string,
): Promise<void> {
  const map = await readMap(userId, "by_entity");
  removeFromMap(map, entityId, docId);
  await writeMap(userId, "by_entity", map);
}

/**
 * by_fingerprint : contentHash exact + bandes SimHash (LSH).
 * Clés : `hash:<sha256>` | `sim:<full>` | `b0:xxxx` …
 */
export async function indexFingerprint(
  userId: string,
  contentHash: string,
  docId: string,
  simhash?: string | null,
): Promise<void> {
  if (!contentHash && !simhash) return;
  const map = await readMap(userId, "by_fingerprint");
  if (contentHash) {
    addToMap(map, `hash:${contentHash}`, docId);
  }
  if (simhash) {
    addToMap(map, `sim:${simhash}`, docId);
    for (const band of simhashBands(simhash)) {
      addToMap(map, band, docId);
    }
  }
  await writeMap(userId, "by_fingerprint", map);
}

export async function getDocsByContentHash(
  userId: string,
  contentHash: string,
): Promise<string[]> {
  if (!contentHash) return [];
  const map = await readMap(userId, "by_fingerprint");
  return map[`hash:${contentHash}`] ?? [];
}

/** Candidats LSH SimHash (union des bandes) — pas un scan N. */
export async function getDocsBySimhashBands(
  userId: string,
  simhash: string,
): Promise<string[]> {
  if (!simhash) return [];
  const map = await readMap(userId, "by_fingerprint");
  const set = new Set<string>();
  for (const band of simhashBands(simhash)) {
    for (const id of map[band] ?? []) set.add(id);
  }
  return [...set];
}

export async function getSimhashForLookup(
  userId: string,
  simhash: string,
): Promise<string[]> {
  if (!simhash) return [];
  const map = await readMap(userId, "by_fingerprint");
  return map[`sim:${simhash}`] ?? [];
}

export async function indexDeadlineTime(
  userId: string,
  dueDate: string,
  deadlineId: string,
): Promise<void> {
  if (!dueDate) return;
  const map = await readMap(userId, "deadline_time");
  addToMap(map, dueDate, deadlineId);
  await writeMap(userId, "deadline_time", map);
}

export async function indexEdgesByDoc(
  userId: string,
  docId: string,
  edgeIds: string[],
): Promise<void> {
  const map = await readMap(userId, "edges_by_doc");
  map[docId] = [...new Set(edgeIds)];
  await writeMap(userId, "edges_by_doc", map);
}

export async function getDocsByEntity(
  userId: string,
  entityId: string,
): Promise<string[]> {
  const map = await readMap(userId, "by_entity");
  return map[entityId] ?? [];
}

export async function indexCategoryDoc(
  userId: string,
  category: string,
  docId: string,
): Promise<void> {
  if (!category) return;
  const map = await readMap(userId, "by_category");
  addToMap(map, category, docId);
  await writeMap(userId, "by_category", map);
}

export async function getDocsByCategory(
  userId: string,
  category: string,
): Promise<string[]> {
  const map = await readMap(userId, "by_category");
  return map[category] ?? [];
}

export async function indexFamilyDoc(
  userId: string,
  familyId: string,
  docId: string,
): Promise<void> {
  if (!familyId) return;
  const map = await readMap(userId, "by_family");
  addToMap(map, familyId, docId);
  await writeMap(userId, "by_family", map);
}

export async function getDocsByFamily(
  userId: string,
  familyId: string,
): Promise<string[]> {
  const map = await readMap(userId, "by_family");
  return map[familyId] ?? [];
}

/** Taille corpus user (incrémentale) pour K = min(20, 2√N). */
export async function bumpCorpusSize(
  userId: string,
  docId: string,
): Promise<number> {
  const map = await readMap(userId, "corpus_docs");
  const before = Object.keys(map).length;
  if (!map[docId]) {
    map[docId] = ["1"];
    await writeMap(userId, "corpus_docs", map);
    return before + 1;
  }
  return before;
}

export async function getCorpusSize(userId: string): Promise<number> {
  const map = await readMap(userId, "corpus_docs");
  return Object.keys(map).length;
}

export async function removeDocFromIndexes(
  userId: string,
  docId: string,
  options?: { deadlineIds?: string[] },
): Promise<void> {
  const deadlineIds = new Set(options?.deadlineIds ?? []);
  for (const name of [
    "by_entity",
    "by_fingerprint",
    "by_category",
    "by_family",
    "edges_by_doc",
    "deadline_time",
    "corpus_docs",
  ]) {
    const map = await readMap(userId, name);
    let dirty = false;
    if (name === "edges_by_doc" || name === "corpus_docs") {
      if (map[docId]) {
        delete map[docId];
        dirty = true;
      }
    } else if (name === "deadline_time") {
      // Valeurs = deadlineId (UUID), pas docId — purger via la liste fournie.
      for (const key of Object.keys(map)) {
        const next = (map[key] ?? []).filter((id) => !deadlineIds.has(id));
        if (next.length !== (map[key] ?? []).length) {
          dirty = true;
          if (next.length === 0) delete map[key];
          else map[key] = next;
        }
      }
    } else {
      for (const key of Object.keys(map)) {
        const next = (map[key] ?? []).filter((id) => id !== docId);
        if (next.length !== (map[key] ?? []).length) {
          dirty = true;
          if (next.length === 0) delete map[key];
          else map[key] = next;
        }
      }
    }
    if (dirty) await writeMap(userId, name, map);
  }
}
