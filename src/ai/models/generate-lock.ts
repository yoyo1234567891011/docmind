import { AppError } from "@/lib/errors";
import { acquireRedisLease } from "@/lib/redis-lease";
import { getRedis, isRedisConfigured } from "@/lib/redis";
import { isCloudLlmEnabled } from "@/ai/models/llm-provider";
import { addAnalysisLockWaitMs } from "@/services/analysis-jobs/timing";
import { latencySpan } from "@/services/analysis-jobs/latency-diag";

/**
 * Sérialise les appels /api/generate Ollama.
 * - File process-local (évite contention intra-worker)
 * - Lease Redis global `docmind:ollama:generate` si REDIS_URL
 *   (une seule génération GPU active sur le cluster)
 */

let tail: Promise<void> = Promise.resolve();
let activeCount = 0;
let activeKey: string | null = null;

/** Attente max en file avant rejet (évite blocage si GPU saturé). */
const DEFAULT_LOCK_MAX_WAIT_MS = 300_000;

const OLLAMA_REDIS_KEY = "docmind:ollama:generate";

function lockMaxWaitMs(): number {
  const fromEnv = Number(process.env.OLLAMA_LOCK_MAX_WAIT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0
    ? fromEnv
    : DEFAULT_LOCK_MAX_WAIT_MS;
}

function ollamaLeaseTtlMs(): number {
  const fromEnv = Number(process.env.OLLAMA_LOCK_TTL_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  // Couvre une génération ; expiration → reprise après crash worker.
  return lockMaxWaitMs();
}

/** Sleep annulable — évite les timers 300s orphelins après Promise.race. */
function cancellableSleep(ms: number): {
  promise: Promise<void>;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return {
    promise,
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

export function getOllamaGenerateLockState(): {
  activeCount: number;
  activeKey: string | null;
} {
  return { activeCount, activeKey };
}

async function withOllamaRedisLease<T>(
  key: string,
  fn: () => Promise<T>,
  waitMs: number,
): Promise<T> {
  if (!isRedisConfigured()) {
    return fn();
  }
  const redis = getRedis();
  if (!redis) {
    throw new AppError(
      "OLLAMA_UNAVAILABLE",
      "Redis configuré mais indisponible — génération refusée (fail-closed multi-instance).",
      503,
    );
  }
  const lease = await acquireRedisLease({
    redisKey: OLLAMA_REDIS_KEY,
    ttlMs: ollamaLeaseTtlMs(),
    waitMs,
  });
  if (!lease) {
    throw new AppError(
      "OLLAMA_UNAVAILABLE",
      "L’analyse est saturée (verrou GPU distribué). Réessayez dans quelques minutes — l’aperçu reste utilisable si disponible.",
      503,
    );
  }
  console.info(`[ollama] redis lease acquired key=${key}`);
  try {
    return await fn();
  } finally {
    await lease.release();
    console.info(`[ollama] redis lease released key=${key}`);
  }
}

/**
 * Exécute `fn` en exclusion mutuelle.
 * `key` : diagnostic (hash prompt / modèle).
 * Si la file dépasse OLLAMA_LOCK_MAX_WAIT_MS → erreur claire (pas de hang).
 *
 * `bypassLocalQueue` : ignore la file process (simule un 2ᵉ worker).
 */
export async function withOllamaGenerateLock<T>(
  key: string,
  fn: () => Promise<T>,
  options?: { bypassLocalQueue?: boolean },
): Promise<T> {
  // Groq / API cloud : pas de verrou GPU Redis ni file process (latence inutile).
  if (isCloudLlmEnabled()) {
    return fn();
  }

  const maxWait = lockMaxWaitMs();

  if (options?.bypassLocalQueue) {
    return withOllamaRedisLease(key, fn, maxWait);
  }

  const prev = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });

  const waitStarted = Date.now();
  if (activeCount > 0) {
    console.info(
      `[ollama] lock wait key=${key} activeKey=${activeKey} active=${activeCount}`,
    );
  }

  const waiter = cancellableSleep(maxWait);
  let acquired: boolean;
  try {
    acquired = await Promise.race([
      prev.then(() => true as const),
      waiter.promise.then(() => false as const),
    ]);
  } finally {
    waiter.cancel();
  }

  if (!acquired) {
    // Libère notre maillon quand le précédent termine — sans prendre le GPU
    void prev.finally(() => release());
    throw new AppError(
      "OLLAMA_UNAVAILABLE",
      "L’analyse est saturée (file d’attente GPU trop longue). Réessayez dans quelques minutes — l’aperçu reste utilisable si disponible.",
      503,
    );
  }

  const waitMs = Date.now() - waitStarted;

  if (waitMs > 0) {
    addAnalysisLockWaitMs(waitMs);
    latencySpan("preLlmWaitMs", waitMs);
  }

  if (waitMs > 50) {
    void import("@/services/monitoring/store")
      .then(({ appendMonitoringEvent }) =>
        appendMonitoringEvent({
          name: "queue.wait",
          meta: { waitMs, key, activeKey },
        }),
      )
      .catch(() => undefined);
  }

  activeCount += 1;
  activeKey = key;
  console.info(`[ollama] lock acquired key=${key} active=${activeCount}`);

  try {
    const remaining = Math.max(0, maxWait - (Date.now() - waitStarted));
    return await withOllamaRedisLease(key, fn, remaining);
  } finally {
    activeCount = Math.max(0, activeCount - 1);
    activeKey = activeCount > 0 ? activeKey : null;
    console.info(
      `[ollama] lock released key=${key} remaining=${activeCount}`,
    );
    release();
  }
}
