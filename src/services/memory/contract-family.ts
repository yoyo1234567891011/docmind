import { randomUUID } from "crypto";
import path from "path";

import { userMemoryDir } from "@/config/paths";
import {
  userFileEnsureDir,
  userFileRead,
  userFileWrite,
} from "@/lib/user-files";
import { indexFamilyDoc } from "@/services/memory/indexes";

export interface ContractFamily {
  id: string;
  userId: string;
  category: string;
  primaryEntityId: string | null;
  label: string;
  memberDocIds: string[];
  currentDocId: string | null;
  status: "active" | "ended" | "unknown";
  createdAt: string;
  updatedAt: string;
}

function familiesFile(userId: string): string {
  return path.join(userMemoryDir(userId), "families.json");
}

async function readAll(userId: string): Promise<ContractFamily[]> {
  try {
    const raw = await userFileRead(userId, familiesFile(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { families?: ContractFamily[] };
    return (parsed.families ?? []).filter((f) => f.userId === userId);
  } catch {
    return [];
  }
}

async function writeAll(
  userId: string,
  families: ContractFamily[],
): Promise<void> {
  await userFileEnsureDir(userMemoryDir(userId));
  await userFileWrite(
    userId,
    familiesFile(userId),
    JSON.stringify(
      { schema: "docmind-families-v1", updatedAt: new Date().toISOString(), families },
      null,
      2,
    ),
  );
}

export async function listContractFamilies(
  userId: string,
): Promise<ContractFamily[]> {
  return readAll(userId);
}

export async function findFamilyForEntityCategory(
  userId: string,
  category: string,
  primaryEntityId: string | null,
): Promise<ContractFamily | null> {
  if (!primaryEntityId) return null;
  const all = await readAll(userId);
  return (
    all.find(
      (f) =>
        f.category === category &&
        f.primaryEntityId === primaryEntityId &&
        f.status === "active",
    ) ?? null
  );
}

/**
 * Upsert famille contrat : même entity + catégorie.
 * Ordonne members par analyzedAt si fourni via currentDocId = newest.
 */
export async function upsertContractFamily(input: {
  userId: string;
  category: string;
  primaryEntityId: string | null;
  label: string;
  docIds: string[];
  currentDocId: string;
}): Promise<ContractFamily> {
  const all = await readAll(input.userId);
  let family = all.find(
    (f) =>
      f.category === input.category &&
      f.primaryEntityId === input.primaryEntityId &&
      f.status === "active",
  );

  const now = new Date().toISOString();
  if (!family) {
    family = {
      id: randomUUID(),
      userId: input.userId,
      category: input.category,
      primaryEntityId: input.primaryEntityId,
      label: input.label,
      memberDocIds: [],
      currentDocId: input.currentDocId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    all.push(family);
  }

  const members = new Set([...family.memberDocIds, ...input.docIds]);
  family.memberDocIds = [...members];
  family.currentDocId = input.currentDocId;
  family.label = input.label || family.label;
  family.updatedAt = now;

  const idx = all.findIndex((f) => f.id === family!.id);
  all[idx] = family;
  await writeAll(input.userId, all);

  for (const docId of family.memberDocIds) {
    await indexFamilyDoc(input.userId, family.id, docId);
  }
  return family;
}

/** Retire un document des familles (history delete). */
export async function removeDocFromFamilies(
  userId: string,
  documentId: string,
): Promise<void> {
  const all = await readAll(userId);
  let dirty = false;
  const next = all
    .map((family) => {
      if (!family.memberDocIds.includes(documentId)) return family;
      dirty = true;
      const memberDocIds = family.memberDocIds.filter((id) => id !== documentId);
      return {
        ...family,
        memberDocIds,
        currentDocId:
          family.currentDocId === documentId
            ? memberDocIds[0] ?? null
            : family.currentDocId,
        updatedAt: new Date().toISOString(),
      };
    })
    .filter((family) => family.memberDocIds.length > 0);
  if (dirty) await writeAll(userId, next);
}
