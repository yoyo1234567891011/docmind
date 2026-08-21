/**
 * Concurrence P2 (analyse approfondie) — charge intelligente Groq.
 *
 * - Plafond normal : ANALYSIS_P2_MAX_CONCURRENCY (3)
 * - Après un 429/TPM : descente à 1, puis remontée 1 → 2 → 3 à chaque succès
 * - État partagé Redis si disponible (multi-instance Vercel), sinon process-local
 *
 * P1 (aperçu local) n’est pas concerné.
 */

import { getRedis, isRedisConfigured } from "@/lib/redis";

/**
 * Nombre max de jobs P2 « processing » en parallèle (bêta).
 * 1 analyse seule reste rapide ; 2–3 simultanées OK ; au-delà = file.
 */
export const ANALYSIS_P2_MAX_CONCURRENCY = 3;

/** Après 429 : concurrence effective forcée à 1. */
export const ANALYSIS_P2_THROTTLE_FLOOR = 1;

const REDIS_KEY = "docmind:p2:eff_concurrency";
/** TTL Redis du curseur de concurrence (auto-reset vers max si inactif). */
const REDIS_TTL_SEC = 15 * 60;

type LocalState = { limit: number };
const g = globalThis as typeof globalThis & {
  __docmindP2Concurrency?: LocalState;
};

function localState(): LocalState {
  if (!g.__docmindP2Concurrency) {
    g.__docmindP2Concurrency = { limit: ANALYSIS_P2_MAX_CONCURRENCY };
  }
  return g.__docmindP2Concurrency;
}

function clampLimit(n: number): number {
  return Math.min(
    ANALYSIS_P2_MAX_CONCURRENCY,
    Math.max(ANALYSIS_P2_THROTTLE_FLOOR, Math.floor(n)),
  );
}

/** Concurrence effective actuelle (1…MAX). */
export async function getEffectiveP2Concurrency(): Promise<number> {
  if (isRedisConfigured()) {
    const redis = getRedis();
    if (redis) {
      try {
        const raw = await redis.get(REDIS_KEY);
        if (raw != null) {
          const n = Number(raw);
          if (Number.isFinite(n)) return clampLimit(n);
        }
      } catch {
        /* fallback local */
      }
    }
  }
  return clampLimit(localState().limit);
}

/** Après un 429 / saturation : freiner à 1. */
export async function noteP2RateLimitHit(): Promise<void> {
  const next = ANALYSIS_P2_THROTTLE_FLOOR;
  localState().limit = next;
  console.warn(`[p2-concurrency] throttle → ${next} (rate_limit)`);
  if (!isRedisConfigured()) return;
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(REDIS_KEY, String(next), "EX", REDIS_TTL_SEC);
  } catch {
    /* ignore */
  }
}

/** Après un P2 réussi : remonter progressivement vers le max. */
export async function noteP2Success(): Promise<void> {
  const current = await getEffectiveP2Concurrency();
  if (current >= ANALYSIS_P2_MAX_CONCURRENCY) {
    localState().limit = ANALYSIS_P2_MAX_CONCURRENCY;
    return;
  }
  const next = clampLimit(current + 1);
  localState().limit = next;
  console.info(`[p2-concurrency] ramp → ${next}/${ANALYSIS_P2_MAX_CONCURRENCY}`);
  if (!isRedisConfigured()) return;
  const redis = getRedis();
  if (!redis) return;
  try {
    if (next >= ANALYSIS_P2_MAX_CONCURRENCY) {
      await redis.del(REDIS_KEY);
    } else {
      await redis.set(REDIS_KEY, String(next), "EX", REDIS_TTL_SEC);
    }
  } catch {
    /* ignore */
  }
}

/** Tests uniquement. */
export function __resetP2ConcurrencyForTests(): void {
  g.__docmindP2Concurrency = { limit: ANALYSIS_P2_MAX_CONCURRENCY };
}
