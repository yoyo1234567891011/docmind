/**
 * Concurrence P2 (analyse approfondie) — charge intelligente Groq.
 *
 * - Plafond normal : ANALYSIS_P2_MAX_CONCURRENCY (1 sur Groq free — évite 429 TPM)
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
export const ANALYSIS_P2_MAX_CONCURRENCY = 1;

/** Après 429 : concurrence effective forcée à 1. */
export const ANALYSIS_P2_THROTTLE_FLOOR = 1;

/** Groq free tier — fenêtre glissante 1 min. */
const GROQ_FREE_TPM = 8_000;
const GROQ_TPM_WINDOW_MS = 60_000;
const GROQ_TPM_BUFFER_MS = 8_000;
/** Après un 429 : ne pas reclamer avant cette fenêtre (laisse le TPM se vider). */
const GROQ_RATE_LIMIT_COOLDOWN_MS = 50_000;
const REDIS_GROQ_USAGE_KEY = "docmind:p2:last_groq_usage";
const REDIS_GROQ_COOLDOWN_KEY = "docmind:p2:groq_cooldown_until";

type GroqUsage = { at: number; tokens: number };

type LocalState = {
  limit: number;
  lastGroqUsage?: GroqUsage | null;
  groqCooldownUntil?: number;
};
const g = globalThis as typeof globalThis & {
  __docmindP2Concurrency?: LocalState;
};

function localState(): LocalState {
  if (!g.__docmindP2Concurrency) {
    g.__docmindP2Concurrency = { limit: ANALYSIS_P2_MAX_CONCURRENCY };
  }
  return g.__docmindP2Concurrency;
}

function spacingMsForUsage(usage: GroqUsage): number {
  const minGap =
    Math.ceil((usage.tokens / GROQ_FREE_TPM) * GROQ_TPM_WINDOW_MS) +
    GROQ_TPM_BUFFER_MS;
  return Math.max(0, minGap - (Date.now() - usage.at));
}

async function readLastGroqUsage(): Promise<GroqUsage | null> {
  const local = localState().lastGroqUsage;
  if (local) return local;

  if (!isRedisConfigured()) return null;
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(REDIS_GROQ_USAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GroqUsage;
    if (
      typeof parsed?.at === "number" &&
      typeof parsed?.tokens === "number" &&
      parsed.tokens > 0
    ) {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Enregistre la consommation Groq pour espacer le prochain job P2 (évite 429 TPM). */
export async function noteP2GroqTokenUsage(tokens: number): Promise<void> {
  if (!(tokens > 0)) return;
  const usage: GroqUsage = { at: Date.now(), tokens };
  localState().lastGroqUsage = usage;
  if (!isRedisConfigured()) return;
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(
      REDIS_GROQ_USAGE_KEY,
      JSON.stringify(usage),
      "EX",
      120,
    );
  } catch {
    /* ignore */
  }
}

/** Après saturation Groq : cooldown global avant le prochain claim P2. */
export async function noteP2GroqRateLimitCooldown(
  cooldownMs = GROQ_RATE_LIMIT_COOLDOWN_MS,
): Promise<void> {
  const until = Date.now() + Math.max(15_000, cooldownMs);
  localState().groqCooldownUntil = until;
  if (!isRedisConfigured()) return;
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(
      REDIS_GROQ_COOLDOWN_KEY,
      String(until),
      "PX",
      Math.max(15_000, cooldownMs) + 5_000,
    );
  } catch {
    /* ignore */
  }
}

async function readGroqCooldownUntil(): Promise<number> {
  const local = localState().groqCooldownUntil;
  if (typeof local === "number" && local > Date.now()) return local;

  if (!isRedisConfigured()) return 0;
  const redis = getRedis();
  if (!redis) return 0;
  try {
    const raw = await redis.get(REDIS_GROQ_COOLDOWN_KEY);
    const until = Number(raw);
    if (Number.isFinite(until) && until > Date.now()) {
      localState().groqCooldownUntil = until;
      return until;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

/** Délai à respecter avant le prochain claim P2 (0 = immédiat). */
export async function getP2TpmSpacingRemainingMs(): Promise<number> {
  const cooldownUntil = await readGroqCooldownUntil();
  const cooldownWait = Math.max(0, cooldownUntil - Date.now());

  const usage = await readLastGroqUsage();
  const tokenWait = usage ? spacingMsForUsage(usage) : 0;

  return Math.max(cooldownWait, tokenWait);
}

/** Attend l’espacement TPM Groq avant un claim (best-effort, plafonné). */
export async function waitForP2TpmSpacing(
  maxWaitMs = 28_000,
): Promise<number> {
  const remaining = await getP2TpmSpacingRemainingMs();
  if (remaining <= 0) return 0;
  const wait = Math.min(remaining, maxWaitMs);
  if (wait > 0) {
    console.info(`[p2-concurrency] tpm_spacing waitMs=${wait}`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  return wait;
}

const REDIS_KEY = "docmind:p2:eff_concurrency";
/** TTL Redis du curseur de concurrence (auto-reset vers max si inactif). */
const REDIS_TTL_SEC = 15 * 60;

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
  g.__docmindP2Concurrency = {
    limit: ANALYSIS_P2_MAX_CONCURRENCY,
    lastGroqUsage: null,
    groqCooldownUntil: 0,
  };
}
