/**
 * Single-flight par document : une seule analyse active pour
 * `userId:documentId`. Les appels concurrents rejoignent la même
 * Promise (pas de 2ᵉ génération LLM).
 */

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

export function documentAnalysisLockKey(
  userId: string,
  documentId: string,
): string {
  return `${userId}:${documentId}`;
}

export function getDocumentAnalysisInFlight(
  key: string,
): DocumentAnalysisInFlightState | null {
  const entry = inflight.get(key);
  if (!entry) return null;
  return {
    key,
    startedAt: entry.startedAt,
    elapsedMs: Date.now() - entry.startedAt,
    waiters: entry.waiters,
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

/**
 * Exécute `run` une seule fois par `key`.
 * Les appelants suivants attendent le même résultat (`coalesced: true`).
 */
export async function withDocumentAnalysisSingleFlight<T>(
  key: string,
  run: () => Promise<T>,
): Promise<{ result: T; coalesced: boolean }> {
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

  const entry: Entry<T> = {
    promise: null as unknown as Promise<T>,
    startedAt: Date.now(),
    waiters: 0,
  };

  const promise = (async () => {
    try {
      return await run();
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
