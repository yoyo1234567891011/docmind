import { userDeadlinesDir, userDeadlinesFile } from "@/config/paths";
import {
  userFileEnsureDir,
  userFileRead,
  userFileUnlink,
  userFileWrite,
} from "@/lib/user-files";
import type { MemoryDeadline } from "@/types/memory";

export async function listDeadlinesForDoc(
  userId: string,
  docId: string,
): Promise<MemoryDeadline[]> {
  try {
    const raw = await userFileRead(userId, userDeadlinesFile(userId, docId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { deadlines?: MemoryDeadline[] };
    return (parsed.deadlines ?? []).filter((d) => d.userId === userId);
  } catch {
    return [];
  }
}

export async function saveDeadlinesForDoc(
  userId: string,
  docId: string,
  deadlines: MemoryDeadline[],
): Promise<void> {
  await userFileEnsureDir(userDeadlinesDir(userId));
  await userFileWrite(
    userId,
    userDeadlinesFile(userId, docId),
    JSON.stringify(
      {
        schema: "docmind-deadlines-v1",
        documentId: docId,
        updatedAt: new Date().toISOString(),
        deadlines,
      },
      null,
      2,
    ),
  );
}

export async function deleteDeadlinesForDoc(
  userId: string,
  docId: string,
): Promise<void> {
  await userFileUnlink(userId, userDeadlinesFile(userId, docId));
}
