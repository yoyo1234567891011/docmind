import { userClausesDir, userClausesFile } from "@/config/paths";
import {
  userFileEnsureDir,
  userFileRead,
  userFileUnlink,
  userFileWrite,
} from "@/lib/user-files";
import type { MemoryClause } from "@/types/memory";

export async function listClausesForDoc(
  userId: string,
  docId: string,
): Promise<MemoryClause[]> {
  try {
    const raw = await userFileRead(userId, userClausesFile(userId, docId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { clauses?: MemoryClause[] };
    return (parsed.clauses ?? []).filter((c) => c.userId === userId);
  } catch {
    return [];
  }
}

export async function saveClausesForDoc(
  userId: string,
  docId: string,
  clauses: MemoryClause[],
): Promise<void> {
  await userFileEnsureDir(userClausesDir(userId));
  await userFileWrite(
    userId,
    userClausesFile(userId, docId),
    JSON.stringify(
      {
        schema: "docmind-clauses-v1",
        documentId: docId,
        updatedAt: new Date().toISOString(),
        clauses,
      },
      null,
      2,
    ),
  );
}

export async function deleteClausesForDoc(
  userId: string,
  docId: string,
): Promise<void> {
  await userFileUnlink(userId, userClausesFile(userId, docId));
}
