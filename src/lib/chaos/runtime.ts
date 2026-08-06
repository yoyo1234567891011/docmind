import { isChaosFault, type ChaosFault } from "./faults";

const runtimeFaults = new Set<ChaosFault>();

/**
 * Chaos is opt-in and blocked in production unless explicitly allowed.
 */
export function isChaosEnabled(): boolean {
  if (process.env.DOCMIND_CHAOS !== "1") return false;
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV?.trim().toLowerCase();
  if (
    appEnv === "production" &&
    process.env.DOCMIND_CHAOS_ALLOW_IN_PROD !== "1"
  ) {
    return false;
  }
  return true;
}

function faultsFromEnv(): Set<ChaosFault> {
  const raw = process.env.DOCMIND_CHAOS_FAULTS?.trim();
  if (!raw) return new Set();
  const out = new Set<ChaosFault>();
  for (const part of raw.split(",")) {
    const id = part.trim().toLowerCase();
    if (isChaosFault(id)) out.add(id);
  }
  return out;
}

export function isChaosFaultActive(fault: ChaosFault): boolean {
  if (!isChaosEnabled()) return false;
  if (runtimeFaults.has(fault)) return true;
  return faultsFromEnv().has(fault);
}

export function activateChaosFault(fault: ChaosFault): void {
  if (!isChaosEnabled()) {
    throw new Error(
      "Chaos désactivé — définir DOCMIND_CHAOS=1 avant d’activer une faute.",
    );
  }
  runtimeFaults.add(fault);
}

export function deactivateChaosFault(fault: ChaosFault): void {
  runtimeFaults.delete(fault);
}

export function clearChaosFaults(): void {
  runtimeFaults.clear();
}

export function listActiveChaosFaults(): ChaosFault[] {
  if (!isChaosEnabled()) return [];
  return [...new Set([...runtimeFaults, ...faultsFromEnv()])];
}

/** Run fn with a single fault active, then restore previous runtime set. */
export async function withChaosFault<T>(
  fault: ChaosFault,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = new Set(runtimeFaults);
  activateChaosFault(fault);
  try {
    return await fn();
  } finally {
    runtimeFaults.clear();
    for (const f of prev) runtimeFaults.add(f);
  }
}
