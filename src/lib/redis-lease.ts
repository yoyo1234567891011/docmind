/**
 * Lease Redis SET NX + libération token-safe (multi-instance).
 * Utilisé par keyed-lock, single-flight analyse, generate-lock Ollama.
 */

import { getRedis, isRedisConfigured } from "@/lib/redis";

const RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

export type RedisLease = {
  token: string;
  release: () => Promise<void>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Tente d’acquérir un lease jusqu’à `waitMs`.
 * `waitMs: 0` = un seul essai NX.
 * Retourne null si Redis non configuré / client absent / NX échoue dans le délai.
 */
export async function acquireRedisLease(options: {
  redisKey: string;
  ttlMs: number;
  waitMs: number;
}): Promise<RedisLease | null> {
  if (!isRedisConfigured()) return null;
  const redis = getRedis();
  if (!redis) return null;

  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ttlSec = Math.max(2, Math.ceil(options.ttlMs / 1000));
  const deadline = Date.now() + Math.max(0, options.waitMs);

  for (;;) {
    const ok = await redis.set(
      options.redisKey,
      token,
      "EX",
      ttlSec,
      "NX",
    );
    if (ok === "OK") {
      return {
        token,
        release: async () => {
          try {
            await redis.eval(RELEASE_LUA, 1, options.redisKey, token);
          } catch {
            /* best-effort */
          }
        },
      };
    }
    if (Date.now() >= deadline) return null;
    await sleep(40 + Math.floor(Math.random() * 40));
  }
}

export async function redisGet(redisKey: string): Promise<string | null> {
  if (!isRedisConfigured()) return null;
  const redis = getRedis();
  if (!redis) return null;
  const value = await redis.get(redisKey);
  return value ?? null;
}

export async function redisSetEx(
  redisKey: string,
  value: string,
  ttlSec: number,
): Promise<void> {
  if (!isRedisConfigured()) return;
  const redis = getRedis();
  if (!redis) return;
  await redis.set(redisKey, value, "EX", Math.max(1, ttlSec));
}
