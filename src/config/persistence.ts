import { isDeployedEnv } from "@/lib/env-validate";

/**
 * Backend de persistance critique.
 * - fs : fichiers locaux (dev uniquement recommandé)
 * - persistent : PostgreSQL + Object Storage S3
 */
export type StorageBackend = "fs" | "persistent";

export function isS3Configured(): boolean {
  return Boolean(
    process.env.S3_BUCKET?.trim() &&
      process.env.S3_ACCESS_KEY_ID?.trim() &&
      process.env.S3_SECRET_ACCESS_KEY?.trim() &&
      (process.env.S3_ENDPOINT?.trim() || process.env.AWS_REGION?.trim()),
  );
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getStorageBackend(): StorageBackend {
  const forced = process.env.DOCMIND_STORAGE?.trim().toLowerCase();
  if (forced === "fs") return "fs";
  if (forced === "persistent") return "persistent";

  if (isDatabaseConfigured() && isS3Configured()) return "persistent";
  return "fs";
}

export function usePersistentStorage(): boolean {
  return getStorageBackend() === "persistent";
}

/**
 * Écritures / mkdir locaux autorisés (dev FS uniquement).
 * Jamais sur Vercel ni en mode persistent (Postgres / S3 / Redis).
 */
export function canUseLocalFilesystem(): boolean {
  if (usePersistentStorage()) return false;
  if (isDeployedEnv()) return false;
  return true;
}

function isTruthyFlag(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

function isFalsyFlag(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "0" || v === "false" || v === "off";
}

/**
 * Lecture FS si miss PG/Redis + promote lazy.
 * Défaut: désactivé. Opt-in local uniquement: DOCMIND_FS_FALLBACK=1
 * En déployé: toujours false (aucune promotion FS → PG/Redis).
 */
export function isFsFallbackEnabled(): boolean {
  if (!usePersistentStorage()) return false;
  // Fail-closed production: résidus FS multi-instance ne doivent jamais réhydrater PG/Redis.
  if (isDeployedEnv()) return false;
  return isTruthyFlag(process.env.DOCMIND_FS_FALLBACK);
}

/**
 * Écrit aussi sur le FS pendant la transition (rollback possible).
 * Défaut: désactivé. Activer: DOCMIND_FS_DUAL_WRITE=1
 */
export function isFsDualWriteEnabled(): boolean {
  if (!usePersistentStorage()) return false;
  if (isDeployedEnv()) return false;
  return isTruthyFlag(process.env.DOCMIND_FS_DUAL_WRITE);
}

/** En déployé, persistent + Redis + FS fallback coupé sont obligatoires. */
export function assertPersistentReadyOrThrow(): void {
  if (!isDeployedEnv()) return;
  // DOCMIND_SKIP_ENV_ASSERT ne peut pas contourner ces protections en déployé.

  if (!isDatabaseConfigured()) {
    throw new Error(
      "[docmind:env] DATABASE_URL manquant — requis en production (Postgres).",
    );
  }
  if (!isS3Configured()) {
    throw new Error(
      "[docmind:env] S3_* manquant — requis en production (Object Storage).",
    );
  }
  if (!process.env.REDIS_URL?.trim()) {
    throw new Error(
      "[docmind:env] REDIS_URL manquant — requis en production (rate-limit).",
    );
  }

  const storage = process.env.DOCMIND_STORAGE?.trim().toLowerCase();
  if (storage !== "persistent") {
    throw new Error(
      "[docmind:env] DOCMIND_STORAGE=persistent obligatoire en production (fs / auto interdit).",
    );
  }

  const fallback = process.env.DOCMIND_FS_FALLBACK;
  if (!isFalsyFlag(fallback)) {
    throw new Error(
      "[docmind:env] DOCMIND_FS_FALLBACK=0 obligatoire en production (promotion FS→PG interdite).",
    );
  }
}
