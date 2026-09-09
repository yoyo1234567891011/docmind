/**
 * Single-flight par document : une seule analyse active pour
 * `userId:documentId`.
 *
 * - Process-local Map : coalesce les appels du même worker.
 * - Redis (si REDIS_URL) : lease NX + résultat partagé — 2 instances
 *   n’exécutent qu’un seul job ; TTL permet reprise après crash.
 */

import { AppError } from "@/lib/errors";
import {
  acquireRedisLease,
  redisGet,
  redisSetEx,
} from "@/lib/redis-lease";
import { isRedisConfigured, getRedis } from "@/lib/redis";

export type DocumentAnalysisInFlightState = {
  key: string;
  startedAt: number;
  elapsedMs: number;
  waiters: number;
};

type Entry<T> = {
  promise: Promise<T>;
  startedAt: number;
  waiters: number;
};

const inflight = new Map<string, Entry<unknown>>();

const FLIGHT_PREFIX = "docmind:analyze:flight:";
const RESULT_PREFIX = "docmind:analyze:result:";

/** TTL lease analyse (reprise après crash si le worker meurt). */
function analyzeLockTtlMs(): number {
  const fromEnv = Number(process.env.ANALYZE_LOCK_TTL_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 600_000;
}

function flightRedisKey(key: string): string {
  return `${FLIGHT_PREFIX}${key}`;
}

function resultRedisKey(key: string): string {
  return `${RESULT_PREFIX}${key}`;
}

export function documentAnalysisLockKey(
  userId: string,
  documentId: string,
): string {
  return `${userId}:${documentId}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * État in-flight local + Redis (autre instance).
 */
export async function getDocumentAnalysisInFlight(
  key: string,
): Promise<DocumentAnalysisInFlightState | null> {
  const entry = inflight.get(key);
  if (entry) {
    return {
      key,
      startedAt: entry.startedAt,
      elapsedMs: Date.now() - entry.startedAt,
      waiters: entry.waiters,
    };
  }

  if (!isRedisConfigured()) return null;
  const raw = await redisGet(flightRedisKey(key));
  if (!raw) return null;
  // token = `${Date.now()}-${random}`
  const startedAt = Number(raw.split("-")[0]);
  const started = Number.isFinite(startedAt) ? startedAt : Date.now();
  return {
    key,
    startedAt: started,
    elapsedMs: Date.now() - started,
    waiters: 0,
  };
}

export function listDocumentAnalysisInFlight(): DocumentAnalysisInFlightState[] {
  return [...inflight.entries()].map(([key, entry]) => ({
    key,
    startedAt: entry.startedAt,
    elapsedMs: Date.now() - entry.startedAt,
    waiters: entry.waiters,
  }));
}

async function publishDistributedResult<T>(key: string, result: T): Promise<void> {
  try {
    const payload = JSON.stringify(result);
    await redisSetEx(resultRedisKey(key), payload, 120);
  } catch {
    /* résultat non sérialisable — waiters verront ANALYSIS_IN_PROGRESS */
  }
}

async function readDistributedResult<T>(key: string): Promise<T | undefined> {
  const raw = await redisGet(resultRedisKey(key));
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * Exécute `run` au plus une fois (cluster Redis).
 * Sans Redis : process-local uniquement (dev).
 *
 * `bypassLocalCoalesce` : simule un autre worker (ignore la Map process).
 */
export async function runDocumentAnalysisDistributed<T>(
  key: string,
  run: () => Promise<T>,
): Promise<{ result: T; didRun: boolean }> {
  if (!isRedisConfigured()) {
    return { result: await run(), didRun: true };
  }

  const redis = getRedis();
  if (!redis) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Redis configuré mais indisponible — analyse refusée (fail-closed multi-instance).",
      503,
    );
  }

  const ttlMs = analyzeLockTtlMs();
  const deadline = Date.now() + ttlMs;

  while (Date.now() < deadline) {
    const remoteResult = await readDistributedResult<T>(key);
    if (remoteResult !== undefined) {
      return { result: remoteResult, didRun: false };
    }

    const lease = await acquireRedisLease({
      redisKey: flightRedisKey(key),
      ttlMs,
      waitMs: 0,
    });

    if (lease) {
      try {
        const result = await run();
        await publishDistributedResult(key, result);
        return { result, didRun: true };
      } finally {
        await lease.release();
      }
    }

    // Lease tenu ailleurs — attendre résultat ou expiration (crash → TTL).
    for (let i = 0; i < 25 && Date.now() < deadline; i += 1) {
      const got = await readDistributedResult<T>(key);
      if (got !== undefined) {
        return { result: got, didRun: false };
      }
      const held = await redisGet(flightRedisKey(key));
      if (!held) break; // crash / TTL — retenter acquire
      await sleep(40 + Math.floor(Math.random() * 40));
    }
  }

  throw new AppError(
    "ANALYSIS_IN_PROGRESS",
    "Analyse déjà en cours sur une autre instance (verrou distribué). Réessayez dans un instant.",
    409,
  );
}

/**
 * Exécute `run` une seule fois par `key`.
 * Les appelants suivants du même process attendent le même résultat (`coalesced: true`).
 *
 * Options:
 * - `bypassLocalCoalesce` : ignore la Map locale (test / 2ᵉ worker simulé).
 */
export async function withDocumentAnalysisSingleFlight<T>(
  key: string,
  run: () => Promise<T>,
  options?: { bypassLocalCoalesce?: boolean },
): Promise<{ result: T; coalesced: boolean }> {
  if (!options?.bypassLocalCoalesce) {
    const existing = inflight.get(key) as Entry<T> | undefined;
    if (existing) {
      existing.waiters += 1;
      console.info(
        `[analyze] coalesce wait key=${key} waiters=${existing.waiters} elapsedMs=${Date.now() - existing.startedAt}`,
      );
      try {
        const result = await existing.promise;
        console.info(`[analyze] coalesce done key=${key}`);
        return { result, coalesced: true };
      } finally {
        existing.waiters = Math.max(0, existing.waiters - 1);
      }
    }
  }

  if (options?.bypassLocalCoalesce) {
    const { result, didRun } = await runDocumentAnalysisDistributed(key, run);
    return { result, coalesced: !didRun };
  }

  const entry: Entry<T> = {
    promise: null as unknown as Promise<T>,
    startedAt: Date.now(),
    waiters: 0,
  };

  const promise = (async () => {
    try {
      const { result } = await runDocumentAnalysisDistributed(key, run);
      return result;
    } finally {
      if (inflight.get(key) === entry) {
        inflight.delete(key);
      }
      console.info(
        `[analyze] single-flight released key=${key} durationMs=${Date.now() - entry.startedAt}`,
      );
    }
  })();

  entry.promise = promise;
  inflight.set(key, entry as Entry<unknown>);
  console.info(`[analyze] single-flight start key=${key}`);

  try {
    const result = await promise;
    console.info(
      `[analyze] single-flight done key=${key} durationMs=${Date.now() - entry.startedAt}`,
    );
    return { result, coalesced: false };
  } catch (error) {
    console.info(
      `[analyze] single-flight error key=${key} durationMs=${Date.now() - entry.startedAt} message=${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    throw error;
  }
}
