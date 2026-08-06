import { AppError } from "@/lib/errors";

/**
 * Sérialise les appels /api/generate Ollama (une seule génération active
 * dans le process Node). Empêche le double-run GPU après timeout.
 */
let tail: Promise<void> = Promise.resolve();
let activeCount = 0;
let activeKey: string | null = null;

/** Attente max en file avant rejet (évite blocage si GPU saturé). */
const DEFAULT_LOCK_MAX_WAIT_MS = 300_000;

function lockMaxWaitMs(): number {
  const fromEnv = Number(process.env.OLLAMA_LOCK_MAX_WAIT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0
    ? fromEnv
    : DEFAULT_LOCK_MAX_WAIT_MS;
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

/**
 * Exécute `fn` en exclusion mutuelle.
 * `key` : diagnostic (hash prompt / modèle).
 * Si la file dépasse OLLAMA_LOCK_MAX_WAIT_MS → erreur claire (pas de hang).
 */
export async function withOllamaGenerateLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
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

  const maxWait = lockMaxWaitMs();
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
    return await fn();
  } finally {
    activeCount = Math.max(0, activeCount - 1);
    activeKey = activeCount > 0 ? activeKey : null;
    console.info(
      `[ollama] lock released key=${key} remaining=${activeCount}`,
    );
    release();
  }
}
