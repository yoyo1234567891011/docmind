/**
 * Mutex par clé (process) + option Redis SET NX (multi-instance).
 * Sérialise checkout / abonnement / quotas FS / dual-write mémoire.
 */

import { getRedis, isRedisConfigured } from "@/lib/redis";

type LockGlobal = typeof globalThis & {
  __docmindKeyedLockTails?: Map<string, Promise<unknown>>;
};

const g = globalThis as LockGlobal;

function tails(): Map<string, Promise<unknown>> {
  if (!g.__docmindKeyedLockTails) g.__docmindKeyedLockTails = new Map();
  return g.__docmindKeyedLockTails;
}

async function acquireRedis(
  key: string,
  ttlMs: number,
): Promise<(() => void) | null> {
  if (!isRedisConfigured()) return null;
  const redis = getRedis();
  if (!redis) return null;

  const redisKey = `docmind:lock:${key}`;
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + Math.min(ttlMs, 30_000);
  const ttlSec = Math.max(2, Math.ceil(ttlMs / 1000));

  while (Date.now() < deadline) {
    const ok = await redis.set(redisKey, token, "EX", ttlSec, "NX");
    if (ok === "OK") {
      return () => {
        void redis
          .eval(
            `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
            1,
            redisKey,
            token,
          )
          .catch(() => undefined);
      };
    }
    await new Promise((r) => setTimeout(r, 40 + Math.floor(Math.random() * 40)));
  }
  return null;
}

/**
 * Exécute `fn` en exclusion mutuelle pour `key`.
 * Chaîne de Promises process-local (correcte sous contention) + Redis NX si dispo.
 */
export async function withKeyedLock<T>(
  key: string,
  fn: () => Promise<T>,
  options?: { ttlMs?: number },
): Promise<T> {
  const ttlMs = options?.ttlMs ?? 60_000;
  const map = tails();
  const prev = map.get(key) ?? Promise.resolve();
  let releaseLocal!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseLocal = resolve;
  });
  const tail = prev.then(() => gate);
  map.set(key, tail);

  await prev;

  let releaseRedis: (() => void) | null = null;
  try {
    // Redis configuré : lease obligatoire (pas de fail-open multi-instance).
    if (isRedisConfigured()) {
      releaseRedis = await acquireRedis(key, ttlMs);
      if (!releaseRedis) {
        throw new Error(
          `LOCK_TIMEOUT: impossible d'acquérir le verrou Redis pour ${key}`,
        );
      }
    }
    return await fn();
  } finally {
    releaseRedis?.();
    releaseLocal();
    if (map.get(key) === tail) {
      map.delete(key);
    }
  }
}
