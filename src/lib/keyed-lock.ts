/**
 * Mutex par clé (process) + lease Redis SET NX (multi-instance).
 * Sérialise checkout / abonnement / quotas FS / dual-write mémoire.
 */

import { acquireRedisLease } from "@/lib/redis-lease";
import { isRedisConfigured } from "@/lib/redis";

type LockGlobal = typeof globalThis & {
  __docmindKeyedLockTails?: Map<string, Promise<unknown>>;
};

const g = globalThis as LockGlobal;

function tails(): Map<string, Promise<unknown>> {
  if (!g.__docmindKeyedLockTails) g.__docmindKeyedLockTails = new Map();
  return g.__docmindKeyedLockTails;
}

/**
 * Exécute `fn` en exclusion mutuelle pour `key`.
 * Chaîne de Promises process-local (correcte sous contention) + Redis NX si dispo.
 */
export async function withKeyedLock<T>(
  key: string,
  fn: () => Promise<T>,
  options?: { ttlMs?: number; waitMs?: number },
): Promise<T> {
  const ttlMs = options?.ttlMs ?? 60_000;
  const waitMs = options?.waitMs ?? Math.min(ttlMs, 30_000);
  const map = tails();
  const prev = map.get(key) ?? Promise.resolve();
  let releaseLocal!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseLocal = resolve;
  });
  const tail = prev.then(() => gate);
  map.set(key, tail);

  await prev;

  let lease: Awaited<ReturnType<typeof acquireRedisLease>> = null;
  try {
    // Redis configuré : lease obligatoire (pas de fail-open multi-instance).
    if (isRedisConfigured()) {
      lease = await acquireRedisLease({
        redisKey: `docmind:lock:${key}`,
        ttlMs,
        waitMs,
      });
      if (!lease) {
        throw new Error(
          `LOCK_TIMEOUT: impossible d'acquérir le verrou Redis pour ${key}`,
        );
      }
    }
    return await fn();
  } finally {
    if (lease) await lease.release();
    releaseLocal();
    if (map.get(key) === tail) {
      map.delete(key);
    }
  }
}
