import { mkdir, writeFile } from "fs/promises";
import path from "path";

import { usePersistentStorage } from "@/config/persistence";
import { assertSafeResourceId, userUploadsDir } from "@/config/paths";
import { chaosGate } from "@/lib/chaos";
import { AppError, isAppError } from "@/lib/errors";
import { deletePdfObject, putPdfObject } from "@/lib/storage/s3";
import { pgUpsertDocumentMeta } from "@/services/persistence/history-pg";
import { persistPdfToS3AndPostgres } from "@/services/storage/persist-pdf";

export interface StoredFile {
  id: string;
  absolutePath: string;
  relativePath: string;
  storageKey?: string;
}

export async function savePdfToUploads(
  userId: string,
  id: string,
  bytes: Buffer,
): Promise<StoredFile> {
  try {
    const safeId = assertSafeResourceId(id, "documentId");
    await chaosGate("disk_full");
    await chaosGate("upload_interrupted");

    if (usePersistentStorage()) {
      const persisted = await persistPdfToS3AndPostgres(
        { userId, documentId: safeId, bytes },
        {
          putObject: putPdfObject,
          upsertMeta: pgUpsertDocumentMeta,
          deleteObject: deletePdfObject,
        },
      );
      return {
        id: safeId,
        absolutePath: `s3://${persisted.storageKey}`,
        relativePath: persisted.storageKey,
        storageKey: persisted.storageKey,
      };
    }

    const dir = userUploadsDir(userId);
    await mkdir(dir, { recursive: true });

    const fileName = `${safeId}.pdf`;
    const absolutePath = path.join(dir, fileName);

    await writeFile(absolutePath, bytes);

    return {
      id: safeId,
      absolutePath,
      relativePath: path.join("uploads", userId, fileName),
    };
  } catch (error) {
    if (isAppError(error)) throw error;
    const detail =
      error instanceof Error ? error.message.slice(0, 180) : String(error);
    console.error(`[upload] savePdfToUploads failed: ${detail}`);
    throw new AppError(
      "UPLOAD_FAILED",
      "Impossible d'enregistrer le fichier sur le serveur.",
      500,
    );
  }
}
