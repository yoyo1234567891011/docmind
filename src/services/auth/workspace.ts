import { mkdir } from "fs/promises";

import { canUseLocalFilesystem, usePersistentStorage } from "@/config/persistence";
import {
  assertSafeUserId,
  userClausesDir,
  userDataDir,
  userDeadlinesDir,
  userHistoryDir,
  userMemoryDir,
  userMemoryDocumentsDir,
  userMemoryIndexesDir,
  userRelationsDir,
  userSearchIndexDir,
  userUploadsDir,
} from "@/config/paths";
import { listFolders } from "@/services/folders";
import { listTags } from "@/services/tags";

const readyUsers = new Set<string>();

/**
 * Initialise le workspace isolé d’un utilisateur
 * (documents, analyses, index, dossiers, tags…).
 * En mode persistent : pas de mkdir FS — données en Postgres/S3.
 */
export async function ensureUserWorkspace(userId: string): Promise<void> {
  const id = assertSafeUserId(userId);
  if (readyUsers.has(id)) return;

  if (canUseLocalFilesystem()) {
    await Promise.all([
      mkdir(userDataDir(id), { recursive: true }),
      mkdir(userHistoryDir(id), { recursive: true }),
      mkdir(userUploadsDir(id), { recursive: true }),
      mkdir(userSearchIndexDir(id), { recursive: true }),
      mkdir(userMemoryDir(id), { recursive: true }),
      mkdir(userClausesDir(id), { recursive: true }),
      mkdir(userDeadlinesDir(id), { recursive: true }),
      mkdir(userRelationsDir(id), { recursive: true }),
      mkdir(userMemoryDocumentsDir(id), { recursive: true }),
      mkdir(userMemoryIndexesDir(id), { recursive: true }),
    ]);
  }

  // Crée les blobs / fichiers JSON de base s’ils n’existent pas
  await Promise.all([listFolders(id), listTags(id)]);

  readyUsers.add(id);
}

/** Test helper — reset memoization. */
export function resetUserWorkspaceCache(): void {
  readyUsers.clear();
}
