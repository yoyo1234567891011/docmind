import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { usePersistentStorage } from "@/config/persistence";
import { userFoldersFile } from "@/config/paths";
import { AppError } from "@/lib/errors";
import { listHistoryRecords } from "@/services/history/store";
import {
  pgGetUserBlob,
  pgSaveUserBlob,
} from "@/services/persistence/user-blobs-pg";
import {
  SYSTEM_FOLDER_DEFINITIONS,
  UNFILED_FOLDER_ID,
  type CreateFolderInput,
  type DocumentFolder,
  type FolderWithCount,
  type FoldersListResult,
} from "@/types";

interface FoldersFileShape {
  folders: DocumentFolder[];
}

const FOLDERS_BLOB_KEY = "folders";

const SYSTEM_CREATED_AT = "2020-01-01T00:00:00.000Z";

function getSystemFolders(): DocumentFolder[] {
  return SYSTEM_FOLDER_DEFINITIONS.map((folder) => ({
    id: folder.id,
    name: folder.name,
    description: folder.description,
    system: true,
    createdAt: SYSTEM_CREATED_AT,
  }));
}

async function ensureFoldersFile(userId: string): Promise<string> {
  const filePath = userFoldersFile(userId);
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await readFile(filePath, "utf8");
  } catch {
    const initial: FoldersFileShape = { folders: [] };
    await writeFile(filePath, JSON.stringify(initial, null, 2), "utf8");
  }
  return filePath;
}

async function readCustomFolders(userId: string): Promise<DocumentFolder[]> {
  if (usePersistentStorage()) {
    const parsed = await pgGetUserBlob<FoldersFileShape>(
      userId,
      FOLDERS_BLOB_KEY,
    );
    return Array.isArray(parsed?.folders) ? parsed.folders : [];
  }
  const filePath = await ensureFoldersFile(userId);
  try {
    const content = await readFile(filePath, "utf8");
    const parsed = JSON.parse(content) as FoldersFileShape;
    return Array.isArray(parsed.folders) ? parsed.folders : [];
  } catch {
    return [];
  }
}

async function writeCustomFolders(
  userId: string,
  folders: DocumentFolder[],
): Promise<void> {
  const payload: FoldersFileShape = { folders };
  if (usePersistentStorage()) {
    await pgSaveUserBlob(userId, FOLDERS_BLOB_KEY, payload);
    return;
  }
  const filePath = await ensureFoldersFile(userId);
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

export async function listFolders(userId: string): Promise<DocumentFolder[]> {
  const custom = await readCustomFolders(userId);
  const systemIds = new Set(getSystemFolders().map((folder) => folder.id));
  const safeCustom = custom.filter(
    (folder) => !folder.system && !systemIds.has(folder.id),
  );

  return [...getSystemFolders(), ...safeCustom].sort((a, b) =>
    a.name.localeCompare(b.name, "fr"),
  );
}

export async function getFolderById(
  userId: string,
  id: string,
): Promise<DocumentFolder | null> {
  if (id === UNFILED_FOLDER_ID) {
    return {
      id: UNFILED_FOLDER_ID,
      name: "Non classés",
      description: "Documents non rangés dans un dossier",
      system: true,
      createdAt: SYSTEM_CREATED_AT,
    };
  }

  const folders = await listFolders(userId);
  return folders.find((folder) => folder.id === id) ?? null;
}

export async function assertAssignableFolderId(
  userId: string,
  folderId: string | null,
): Promise<string | null> {
  if (folderId === null || folderId === UNFILED_FOLDER_ID) {
    return null;
  }

  const folder = await getFolderById(userId, folderId);
  if (!folder || folder.id === UNFILED_FOLDER_ID) {
    throw new AppError("BAD_REQUEST", "Dossier introuvable.", 400);
  }

  return folder.id;
}

export async function createFolder(
  userId: string,
  input: CreateFolderInput,
): Promise<DocumentFolder> {
  const name = input.name?.trim();
  if (!name) {
    throw new AppError("BAD_REQUEST", "Le nom du dossier est requis.");
  }
  if (name.length > 60) {
    throw new AppError(
      "BAD_REQUEST",
      "Le nom du dossier ne peut pas dépasser 60 caractères.",
    );
  }

  const existing = await listFolders(userId);
  const normalized = name.toLowerCase();
  if (
    existing.some((folder) => folder.name.toLowerCase() === normalized) ||
    normalized === "non classés" ||
    normalized === "non classes"
  ) {
    throw new AppError(
      "BAD_REQUEST",
      "Un dossier avec ce nom existe déjà.",
      400,
    );
  }

  const folder: DocumentFolder = {
    id: `custom-${randomUUID()}`,
    name,
    description: input.description?.trim() || "Dossier personnalisé",
    system: false,
    createdAt: new Date().toISOString(),
  };

  const custom = await readCustomFolders(userId);
  custom.push(folder);
  await writeCustomFolders(userId, custom);

  return folder;
}

export async function listFoldersWithCounts(
  userId: string,
): Promise<FoldersListResult> {
  const [folders, records] = await Promise.all([
    listFolders(userId),
    listHistoryRecords(userId),
  ]);

  const counts = new Map<string, number>();
  let unfiledCount = 0;

  for (const record of records) {
    if (!record.folderId) {
      unfiledCount += 1;
      continue;
    }
    counts.set(record.folderId, (counts.get(record.folderId) ?? 0) + 1);
  }

  const withCounts: FolderWithCount[] = folders.map((folder) => ({
    ...folder,
    documentCount: counts.get(folder.id) ?? 0,
  }));

  return { folders: withCounts, unfiledCount };
}
