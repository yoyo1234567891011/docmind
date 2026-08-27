import { createHash } from "crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "fs/promises";
import path from "path";

import { getOptimizationConfig } from "@/config/optimizations";
import {
  canUseLocalFilesystem,
  isFsDualWriteEnabled,
  isFsFallbackEnabled,
  usePersistentStorage,
} from "@/config/persistence";
import { userAnalysisCacheDir } from "@/config/paths";
import { isDeployedEnv } from "@/lib/env-validate";
import { getRedis, isRedisConfigured } from "@/lib/redis";
import type {
  DocumentAnalysis,
  DocumentClassification,
  PromptUsageSnapshot,
  ReadyReply,
} from "@/types";

/**
 * Version de format du fichier cache.
 * Bump si le schéma JSON change (indépendant du fingerprint).
 */
const CACHE_FORMAT_VERSION = 7 as const;

/** Version pipeline d’analyse (agents / post-processing). */
export const ANALYSIS_PIPELINE_VERSION = "analyze-pipeline-v2";

export interface CacheFingerprint {
  model: string;
  promptsFingerprint: string;
  pipelineVersion: string;
}

export interface CachedAnalysisPayload {
  version: typeof CACHE_FORMAT_VERSION;
  /** Clé complète (texte + fingerprint). */
  cacheKey: string;
  textHash: string;
  fingerprint: CacheFingerprint;
  cachedAt: string;
  model: string;
  classification: DocumentClassification;
  analysis: DocumentAnalysis;
  readyReply: ReadyReply;
}

/** @deprecated alias — tests / imports */
export const CACHE_VERSION = CACHE_FORMAT_VERSION;

export function hashDocumentText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function fingerprintPrompts(snapshot: PromptUsageSnapshot): string {
  const parts = snapshot
    .map(
      (entry) =>
        `${entry.key}:${entry.source}:${entry.versionId ?? "code"}:${entry.version ?? 0}`,
    )
    .sort();
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex").slice(0, 16);
}

export function buildCacheFingerprint(input: {
  model: string;
  promptsUsed: PromptUsageSnapshot;
  pipelineVersion?: string;
}): CacheFingerprint {
  return {
    model: input.model,
    promptsFingerprint: fingerprintPrompts(input.promptsUsed),
    pipelineVersion: input.pipelineVersion ?? ANALYSIS_PIPELINE_VERSION,
  };
}

export function buildCacheKey(text: string, fingerprint: CacheFingerprint): string {
  const textHash = hashDocumentText(text.trim());
  return createHash("sha256")
    .update(
      JSON.stringify({
        textHash,
        model: fingerprint.model,
        prompts: fingerprint.promptsFingerprint,
        pipeline: fingerprint.pipelineVersion,
        format: CACHE_FORMAT_VERSION,
      }),
      "utf8",
    )
    .digest("hex");
}

function useRedisCache(): boolean {
  return (
    isRedisConfigured() &&
    (usePersistentStorage() || isDeployedEnv())
  );
}

function redisCacheKey(userId: string, cacheKey: string): string {
  return `docmind:ac:${userId}:${cacheKey}`;
}

function cacheDir(userId: string): string {
  return userAnalysisCacheDir(userId);
}

function cachePath(userId: string, cacheKey: string): string {
  return path.join(cacheDir(userId), `${cacheKey}.json`);
}

async function ensureCacheDir(userId: string): Promise<void> {
  if (!canUseLocalFilesystem()) return;
  await mkdir(cacheDir(userId), { recursive: true });
}

async function pruneCache(userId: string, maxEntries: number): Promise<void> {
  if (!canUseLocalFilesystem()) return;
  const dir = cacheDir(userId);
  const files = (await readdir(dir).catch(() => [])).filter((f) =>
    f.endsWith(".json"),
  );
  if (files.length <= maxEntries) return;

  const stats = await Promise.all(
    files.map(async (file) => {
      const full = path.join(dir, file);
      try {
        const raw = await readFile(full, "utf8");
        const parsed = JSON.parse(raw) as CachedAnalysisPayload;
        return { full, at: Date.parse(parsed.cachedAt) || 0 };
      } catch {
        return { full, at: 0 };
      }
    }),
  );

  stats.sort((a, b) => a.at - b.at);
  const toRemove = stats.slice(0, Math.max(0, stats.length - maxEntries));
  await Promise.all(
    toRemove.map((item) => unlink(item.full).catch(() => undefined)),
  );
}

function fingerprintsMatch(
  a: CacheFingerprint,
  b: CacheFingerprint,
): boolean {
  return (
    a.model === b.model &&
    a.promptsFingerprint === b.promptsFingerprint &&
    a.pipelineVersion === b.pipelineVersion
  );
}

function isUsableCachedPayload(
  parsed: CachedAnalysisPayload,
): boolean {
  const analysis = parsed.analysis;
  const classification = parsed.classification;
  if (!analysis || typeof analysis !== "object") return false;
  if (!classification || typeof classification !== "object") return false;
  if (typeof analysis.document_type !== "string") return false;
  if (typeof classification.category !== "string") return false;
  if (!parsed.readyReply || typeof parsed.readyReply !== "object") return false;
  if (typeof parsed.model !== "string" || !parsed.model.trim()) return false;
  return true;
}

function validateCached(
  parsed: CachedAnalysisPayload,
  cacheKey: string,
  fingerprint: CacheFingerprint,
  ttlMs: number,
): CachedAnalysisPayload | null {
  if (parsed.version !== CACHE_FORMAT_VERSION) return null;
  if (parsed.cacheKey !== cacheKey) return null;
  if (!parsed.fingerprint || !fingerprintsMatch(parsed.fingerprint, fingerprint)) {
    return null;
  }
  const age = Date.now() - Date.parse(parsed.cachedAt);
  if (!Number.isFinite(age) || age < 0 || age > ttlMs) return null;
  if (!isUsableCachedPayload(parsed)) return null;
  return parsed;
}

/**
 * Lecture cache — isolée par utilisateur.
 * Redis en multi-instance ; FS en dev local.
 */
export async function getCachedAnalysis(
  userId: string,
  text: string,
  fingerprint: CacheFingerprint,
): Promise<CachedAnalysisPayload | null> {
  const config = getOptimizationConfig().analysisCache;
  if (!config.enabled) return null;

  const cacheKey = buildCacheKey(text, fingerprint);
  try {
    if (useRedisCache()) {
      const redis = getRedis();
      if (redis) {
        const raw = await redis.get(redisCacheKey(userId, cacheKey));
        if (raw) {
          const parsed = JSON.parse(raw) as CachedAnalysisPayload;
          return validateCached(parsed, cacheKey, fingerprint, config.ttlMs);
        }
      }

      // Fallback FS + promote Redis (migration incrémentale, dev local uniquement)
      if (canUseLocalFilesystem() && isFsFallbackEnabled()) {
        try {
          const fsRaw = await readFile(cachePath(userId, cacheKey), "utf8");
          const parsed = JSON.parse(fsRaw) as CachedAnalysisPayload;
          const ok = validateCached(
            parsed,
            cacheKey,
            fingerprint,
            config.ttlMs,
          );
          if (ok && redis) {
            const ttlSec = Math.max(1, Math.ceil(config.ttlMs / 1000));
            const ageMs = Date.now() - Date.parse(ok.cachedAt);
            const remain = Math.max(
              1,
              Math.ceil((config.ttlMs - (Number.isFinite(ageMs) ? ageMs : 0)) / 1000),
            );
            await redis
              .set(
                redisCacheKey(userId, cacheKey),
                JSON.stringify(ok),
                "EX",
                Math.min(ttlSec, remain),
              )
              .catch(() => undefined);
          }
          return ok;
        } catch {
          return null;
        }
      }
      return null;
    }

    if (!canUseLocalFilesystem()) return null;

    const raw = await readFile(cachePath(userId, cacheKey), "utf8");
    const parsed = JSON.parse(raw) as CachedAnalysisPayload;
    return validateCached(parsed, cacheKey, fingerprint, config.ttlMs);
  } catch {
    return null;
  }
}

/**
 * Écriture cache — no-op si désactivé.
 */
export async function setCachedAnalysis(input: {
  userId: string;
  text: string;
  fingerprint: CacheFingerprint;
  model: string;
  classification: DocumentClassification;
  analysis: DocumentAnalysis;
  readyReply: ReadyReply;
}): Promise<void> {
  const config = getOptimizationConfig().analysisCache;
  if (!config.enabled) return;

  const textHash = hashDocumentText(input.text.trim());
  const cacheKey = buildCacheKey(input.text, input.fingerprint);
  const payload: CachedAnalysisPayload = {
    version: CACHE_FORMAT_VERSION,
    cacheKey,
    textHash,
    fingerprint: input.fingerprint,
    cachedAt: new Date().toISOString(),
    model: input.model,
    classification: input.classification,
    analysis: input.analysis,
    readyReply: input.readyReply,
  };

  try {
    if (useRedisCache()) {
      const redis = getRedis();
      if (!redis) return;
      const ttlSec = Math.max(1, Math.ceil(config.ttlMs / 1000));
      await redis.set(
        redisCacheKey(input.userId, cacheKey),
        JSON.stringify(payload),
        "EX",
        ttlSec,
      );
      if (canUseLocalFilesystem() && isFsDualWriteEnabled()) {
        await ensureCacheDir(input.userId);
        await writeFile(
          cachePath(input.userId, cacheKey),
          JSON.stringify(payload),
          "utf8",
        ).catch(() => undefined);
        // Dual-write FS sans prune → croissance disque (Redis a déjà un TTL).
        await pruneCache(input.userId, config.maxEntries).catch(() => undefined);
      }
      return;
    }

    if (!canUseLocalFilesystem()) return;

    await ensureCacheDir(input.userId);
    await writeFile(
      cachePath(input.userId, cacheKey),
      JSON.stringify(payload),
      "utf8",
    );
    await pruneCache(input.userId, config.maxEntries);
  } catch {
    // best-effort
  }
}

export function isAnalysisCacheEnabled(): boolean {
  return getOptimizationConfig().analysisCache.enabled;
}

/** Suppression cache d’un utilisateur (RGPD / delete compte). */
export async function clearUserAnalysisCache(userId: string): Promise<void> {
  if (useRedisCache()) {
    const redis = getRedis();
    if (!redis) return;
    const pattern = `docmind:ac:${userId}:*`;
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== "0");
    return;
  }
  if (!canUseLocalFilesystem()) return;
  const dir = cacheDir(userId);
  const files = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    files.map((file) => unlink(path.join(dir, file)).catch(() => undefined)),
  );
}
