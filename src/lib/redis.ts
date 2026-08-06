import Redis from "ioredis";

type RedisGlobal = typeof globalThis & {
  __docmindRedis?: Redis | null;
  __docmindRedisInitAttempted?: boolean;
};

const g = globalThis as RedisGlobal;

export function getRedisUrl(): string | null {
  return process.env.REDIS_URL?.trim() || null;
}

export function isRedisConfigured(): boolean {
  return Boolean(getRedisUrl());
}

/**
 * Client Redis singleton (globalThis — évite fuites de sockets sous HMR Next).
 * null si REDIS_URL absent.
 */
export function getRedis(): Redis | null {
  const url = getRedisUrl();
  if (!url) return null;
  if (g.__docmindRedis) return g.__docmindRedis;
  if (g.__docmindRedisInitAttempted && !g.__docmindRedis) return null;
  g.__docmindRedisInitAttempted = true;
  try {
    const client = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    client.on("error", (err) => {
      console.error("[redis]", err.message);
    });
    g.__docmindRedis = client;
    return client;
  } catch (error) {
    console.error("[redis] init failed", error);
    g.__docmindRedis = null;
    return null;
  }
}
