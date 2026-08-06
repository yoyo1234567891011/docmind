import { mkdir, writeFile } from "fs/promises";
import path from "path";

import { usePersistentStorage } from "@/config/persistence";
import { assertSafeResourceId, userUploadsDir } from "@/config/paths";
import { chaosGate } from "@/lib/chaos";
import { AppError } from "@/lib/errors";
import { putPdfObject } from "@/lib/storage/s3";
import { pgUpsertDocumentMeta } from "@/services/persistence/history-pg";

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
      const { key } = await putPdfObject(userId, safeId, bytes);
      await pgUpsertDocumentMeta({
        userId,
        documentId: safeId,
        storageKey: key,
        sizeBytes: bytes.byteLength,
      });
      return {
        id: safeId,
        absolutePath: `s3://${key}`,
        relativePath: key,
        storageKey: key,
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
    if (error instanceof AppError) throw error;
    throw new AppError(
      "UPLOAD_FAILED",
      "Impossible d'enregistrer le fichier sur le serveur.",
      500,
    );
  }
}
