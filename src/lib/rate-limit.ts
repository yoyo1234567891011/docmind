/**
 * Rate limit distribué Redis (multi-instance).
 * Fallback mémoire uniquement hors environnements déployés (dev local).
 */

import { chaosGate } from "@/lib/chaos";
import { isDeployedEnv } from "@/lib/env-validate";
import { getRedis, isRedisConfigured } from "@/lib/redis";

interface Bucket {
  count: number;
  resetAt: number;
}

const memoryBuckets = new Map<string, Bucket>();

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number };

const metrics = {
  hits: 0,
  blocks: 0,
  redisErrors: 0,
  memoryFallbacks: 0,
};

export function getRateLimitMetrics() {
  return { ...metrics };
}

function memoryCheck(input: {
  key: string;
  limit: number;
  windowMs: number;
}): RateLimitResult {
  const now = Date.now();
  const existing = memoryBuckets.get(input.key);

  if (!existing || existing.resetAt <= now) {
    memoryBuckets.set(input.key, { count: 1, resetAt: now + input.windowMs });
    metrics.hits += 1;
    return { ok: true };
  }

  if (existing.count >= input.limit) {
    metrics.blocks += 1;
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  metrics.hits += 1;
  return { ok: true };
}

/**
 * INCR + EXPIRE atomique via Lua (fenêtre fixe).
 */
async function redisCheck(input: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<RateLimitResult> {
  await chaosGate("redis_down");
  const redis = getRedis();
  if (!redis) throw new Error("redis unavailable");

  const redisKey = `docmind:rl:${input.key}`;
  const windowSec = Math.max(1, Math.ceil(input.windowMs / 1000));

  const script = `
    local current = redis.call('INCR', KEYS[1])
    if current == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    local ttl = redis.call('TTL', KEYS[1])
    return { current, ttl }
  `;

  const result = (await redis.eval(
    script,
    1,
    redisKey,
    String(windowSec),
  )) as [number, number];

  const count = Number(result[0]);
  const ttl = Number(result[1]);

  if (count > input.limit) {
    metrics.blocks += 1;
    void import("@/services/monitoring/store")
      .then(({ appendMonitoringEvent }) =>
        appendMonitoringEvent({
          name: "server.error",
          meta: {
            code: "RATE_LIMIT",
            key: input.key,
            count,
            limit: input.limit,
          },
        }),
      )
      .catch(() => undefined);
    return {
      ok: false,
      retryAfterSec: Math.max(1, ttl > 0 ? ttl : windowSec),
    };
  }

  metrics.hits += 1;
  return { ok: true };
}

/**
 * Rate limit async (Redis en prod). API synchrone conservée via overload
 * pour compat — préférer checkRateLimitAsync.
 */
export async function checkRateLimitAsync(input: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<RateLimitResult> {
  if (isRedisConfigured()) {
    try {
      return await redisCheck(input);
    } catch {
      metrics.redisErrors += 1;
      if (isDeployedEnv()) {
        // Fail-closed en déployé si Redis HS
        metrics.blocks += 1;
        return { ok: false, retryAfterSec: 30 };
      }
      metrics.memoryFallbacks += 1;
      return memoryCheck(input);
    }
  }

  if (isDeployedEnv()) {
    metrics.blocks += 1;
    return { ok: false, retryAfterSec: 60 };
  }

  metrics.memoryFallbacks += 1;
  return memoryCheck(input);
}

/**
 * @deprecated Utiliser checkRateLimitAsync.
 * En déployé : fail-closed (pas de bucket mémoire multi-instance).
 */
export function checkRateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
}): RateLimitResult {
  void input;
  if (isDeployedEnv()) {
    metrics.blocks += 1;
    return { ok: false, retryAfterSec: 60 };
  }
  metrics.memoryFallbacks += 1;
  return memoryCheck(input);
}

/** Nettoyage buckets mémoire locaux (Redis TTL via EXPIRE). */
export function pruneRateLimitBuckets(maxEntries = 5_000): void {
  const now = Date.now();
  for (const [key, bucket] of memoryBuckets) {
    if (bucket.resetAt <= now) memoryBuckets.delete(key);
  }
  if (memoryBuckets.size <= maxEntries) return;
  const keys = [...memoryBuckets.keys()].slice(
    0,
    memoryBuckets.size - maxEntries,
  );
  for (const key of keys) memoryBuckets.delete(key);
}

/** Alias explicite pour ops / monitoring. */
export function cleanupRateLimitState(): void {
  pruneRateLimitBuckets();
}
