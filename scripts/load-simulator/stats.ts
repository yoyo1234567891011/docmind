import type { LatencyPercentiles } from "./types";

export function avg(vals: number[]): number {
  if (vals.length === 0) return 0;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function percentile(vals: number[], p: number): number {
  if (vals.length === 0) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const i = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[i] ?? 0;
}

export function latencyOf(vals: number[]): LatencyPercentiles {
  return {
    avgMs: avg(vals),
    p50Ms: percentile(vals, 50),
    p95Ms: percentile(vals, 95),
    p99Ms: percentile(vals, 99),
  };
}

export function emptyInfraSummary(note?: string) {
  return {
    configured: false,
    samples: 0,
    okRate: 0,
    avgMs: null as number | null,
    p50Ms: null as number | null,
    p95Ms: null as number | null,
    p99Ms: null as number | null,
    maxMs: null as number | null,
    note,
  };
}
