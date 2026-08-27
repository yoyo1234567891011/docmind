/**
 * Transaction logique S3 ↔ PostgreSQL pour un PDF uploadé.
 *
 * 1. S3 + PG OK → succès
 * 2. S3 échoue → aucun document PG
 * 3. S3 OK + PG échoue → delete S3 immédiat
 * 4. delete S3 échoue → tâche de nettoyage traçable
 */
import { AppError, isAppError } from "@/lib/errors";
import { enqueueStorageCleanupJob } from "@/services/storage/cleanup-jobs";

export type PersistPdfDeps = {
  putObject: (
    userId: string,
    documentId: string,
    bytes: Buffer,
  ) => Promise<{ key: string }>;
  upsertMeta: (input: {
    userId: string;
    documentId: string;
    storageKey: string;
    sizeBytes: number;
  }) => Promise<void>;
  deleteObject: (userId: string, documentId: string) => Promise<void>;
  enqueueCleanup?: typeof enqueueStorageCleanupJob;
};

export type PersistPdfResult = {
  documentId: string;
  storageKey: string;
  sizeBytes: number;
  cleanupJobId?: string;
};

export async function persistPdfToS3AndPostgres(
  input: {
    userId: string;
    documentId: string;
    bytes: Buffer;
  },
  deps: PersistPdfDeps,
): Promise<PersistPdfResult> {
  const enqueue = deps.enqueueCleanup ?? enqueueStorageCleanupJob;
  let storageKey: string | undefined;

  try {
    const put = await deps.putObject(
      input.userId,
      input.documentId,
      input.bytes,
    );
    storageKey = put.key;
  } catch (error) {
    if (isAppError(error)) throw error;
    const detail =
      error instanceof Error ? error.message.slice(0, 200) : String(error);
    console.error(`[upload] S3 put failed: ${detail}`);
    throw new AppError(
      "UPLOAD_FAILED",
      "Impossible d'enregistrer le fichier sur le stockage objet.",
      502,
    );
  }

  try {
    await deps.upsertMeta({
      userId: input.userId,
      documentId: input.documentId,
      storageKey,
      sizeBytes: input.bytes.byteLength,
    });
  } catch (pgError) {
    let cleanupJobId: string | undefined;
    try {
      await deps.deleteObject(input.userId, input.documentId);
    } catch (deleteError) {
      const lastError =
        deleteError instanceof Error
          ? deleteError.message
          : String(deleteError);
      const job = await enqueue({
        kind: "s3_orphan_delete",
        userId: input.userId,
        documentId: input.documentId,
        storageKey,
        reason: "pg_upsert_failed_after_s3_put",
        lastError,
      });
      cleanupJobId = job.id;
      console.error(
        `[upload] S3 orphan after PG failure documentId=${input.documentId} cleanupJobId=${job.id}`,
      );
    }

    if (isAppError(pgError)) throw pgError;
    throw new AppError(
      "UPLOAD_FAILED",
      cleanupJobId
        ? `Échec enregistrement métadonnées (objet S3 en file de nettoyage ${cleanupJobId}).`
        : "Impossible d'enregistrer les métadonnées du document.",
      500,
    );
  }

  return {
    documentId: input.documentId,
    storageKey,
    sizeBytes: input.bytes.byteLength,
  };
}
