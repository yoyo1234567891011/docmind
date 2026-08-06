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
 * Lecture FS si miss PG/Redis + promote lazy.
 * Défaut: activé en mode persistent (migration incrémentale).
 * Couper après validation: DOCMIND_FS_FALLBACK=0
 */
export function isFsFallbackEnabled(): boolean {
  if (!usePersistentStorage()) return false;
  const raw = process.env.DOCMIND_FS_FALLBACK?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

/**
 * Écrit aussi sur le FS pendant la transition (rollback possible).
 * Défaut: désactivé. Activer: DOCMIND_FS_DUAL_WRITE=1
 */
export function isFsDualWriteEnabled(): boolean {
  if (!usePersistentStorage()) return false;
  const raw = process.env.DOCMIND_FS_DUAL_WRITE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

/** En déployé, persistent + Redis sont obligatoires. */
export function assertPersistentReadyOrThrow(): void {
  if (!isDeployedEnv()) return;
  if (process.env.DOCMIND_SKIP_ENV_ASSERT === "1") return;

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
  if (getStorageBackend() !== "persistent") {
    throw new Error(
      "[docmind:env] DOCMIND_STORAGE doit être persistent en production.",
    );
  }
}
