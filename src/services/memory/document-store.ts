import {
  userMemoryDocumentFile,
  userMemoryDocumentsDir,
} from "@/config/paths";
import {
  userFileEnsureDir,
  userFileRead,
  userFileUnlink,
  userFileWrite,
} from "@/lib/user-files";
import type { MemoryDocumentNode } from "@/types/memory";

export async function getMemoryDocument(
  userId: string,
  documentId: string,
): Promise<MemoryDocumentNode | null> {
  try {
    const raw = await userFileRead(
      userId,
      userMemoryDocumentFile(userId, documentId),
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MemoryDocumentNode;
    return parsed.userId === userId ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveMemoryDocument(
  userId: string,
  node: MemoryDocumentNode,
): Promise<void> {
  await userFileEnsureDir(userMemoryDocumentsDir(userId));
  await userFileWrite(
    userId,
    userMemoryDocumentFile(userId, node.documentId),
    JSON.stringify(node, null, 2),
  );
}

export async function deleteMemoryDocument(
  userId: string,
  documentId: string,
): Promise<void> {
  await userFileUnlink(userId, userMemoryDocumentFile(userId, documentId));
}
