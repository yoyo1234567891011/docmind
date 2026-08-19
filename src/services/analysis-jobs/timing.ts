/**
 * Collecteur de timings Ollama (lock wait vs generate HTTP).
 * Instrumentation additive — ne change pas la sérialisation GPU.
 */
import { AsyncLocalStorage } from "async_hooks";

export type AnalysisTimingBucket = {
  lockWaitMs: number;
  generateMs: number;
};

const als = new AsyncLocalStorage<AnalysisTimingBucket>();

export function createAnalysisTimingBucket(): AnalysisTimingBucket {
  return { lockWaitMs: 0, generateMs: 0 };
}

export function runWithAnalysisTiming<T>(
  bucket: AnalysisTimingBucket,
  fn: () => Promise<T>,
): Promise<T> {
  return als.run(bucket, fn);
}

export function getAnalysisTimingBucket(): AnalysisTimingBucket | undefined {
  return als.getStore();
}

export function addAnalysisLockWaitMs(waitMs: number): void {
  const bucket = als.getStore();
  if (!bucket || !(waitMs > 0)) return;
  bucket.lockWaitMs += waitMs;
}

export function addAnalysisGenerateMs(generateMs: number): void {
  const bucket = als.getStore();
  if (!bucket || !(generateMs > 0)) return;
  bucket.generateMs += generateMs;
}
