/** Stats de latence pour budgets reproductibles (pas de max seul). */

export type PerfStats = {
  n: number;
  mean: number;
  median: number;
  p95: number;
  max: number;
};

export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo]!;
  const w = rank - lo;
  return sortedAsc[lo]! * (1 - w) + sortedAsc[hi]! * w;
}

export function computePerfStats(samples: number[]): PerfStats {
  if (samples.length === 0) {
    return { n: 0, mean: 0, median: 0, p95: 0, max: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return {
    n: samples.length,
    mean,
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1]!,
  };
}

/**
 * Répète une mesure : warm-up ignorés + N runs chronométrés.
 * Détecte un budget machine (p95) vs régression algo (median hors norme).
 */
export async function measureRepeated(
  fn: () => void | Promise<void>,
  options?: { warmup?: number; runs?: number },
): Promise<PerfStats> {
  const warmup = options?.warmup ?? 2;
  const runs = options?.runs ?? 9;
  for (let i = 0; i < warmup; i += 1) await fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  return computePerfStats(samples);
}
