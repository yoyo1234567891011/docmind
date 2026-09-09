/**
 * Purge des clés Redis liées à un utilisateur (RGPD Art. 17).
 *
 * Supprimé :
 * - cache analyse `docmind:ac:{userId}:*`
 * - rate-limit contenant userId `docmind:rl:*{userId}*`
 * - single-flight analyse `docmind:analyze:flight:{userId}:*`
 * - résultats partagés `docmind:analyze:result:{userId}:*`
 *
 * Conservé (pas d’identifiant utilisateur / TTL court / lock global) :
 * - `docmind:ollama:generate` (lock GPU process-wide)
 * - `docmind:lock:*` non scoped user (durée courte)
 * - `stripe_webhook_events` est en PG, pas Redis
 */
import { getRedis, isRedisConfigured } from "@/lib/redis";

async function scanDelete(pattern: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  let deleted = 0;
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
    if (keys.length > 0) {
      deleted += await redis.del(...keys);
    }
  } while (cursor !== "0");
  return deleted;
}

export async function purgeUserRedisKeys(userId: string): Promise<{
  deleted: number;
  skipped: boolean;
}> {
  if (!userId.trim()) return { deleted: 0, skipped: true };
  if (!isRedisConfigured()) return { deleted: 0, skipped: true };

  const patterns = [
    `docmind:ac:${userId}:*`,
    `docmind:rl:*${userId}*`,
    `docmind:analyze:flight:${userId}:*`,
    `docmind:analyze:result:${userId}:*`,
    `docmind:lock:*${userId}*`,
  ];

  let deleted = 0;
  for (const pattern of patterns) {
    deleted += await scanDelete(pattern);
  }
  return { deleted, skipped: false };
}
