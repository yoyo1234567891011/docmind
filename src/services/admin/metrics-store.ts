import { mkdir, readFile, writeFile } from "fs/promises";
import { randomUUID } from "crypto";

import { canUseLocalFilesystem } from "@/config/persistence";
import { ADMIN_DIR, ADMIN_METRICS_FILE } from "@/config/paths";
import type {
  AdminFrequentError,
  AdminMetricEvent,
  AdminMetricsFile,
  AdminPerformanceSummary,
} from "@/types/admin";

const MAX_EVENTS = 2000;

function adminFsEnabled(): boolean {
  return canUseLocalFilesystem();
}

async function ensureAdminDir(): Promise<void> {
  if (!adminFsEnabled()) return;
  await mkdir(ADMIN_DIR, { recursive: true });
}

let memoryMetrics: AdminMetricsFile = { events: [] };

export async function readAdminMetrics(): Promise<AdminMetricsFile> {
  if (!adminFsEnabled()) return memoryMetrics;
  await ensureAdminDir();
  try {
    const raw = await readFile(ADMIN_METRICS_FILE, "utf8");
    return JSON.parse(raw) as AdminMetricsFile;
  } catch {
    const empty: AdminMetricsFile = { events: [] };
    try {
      await writeFile(ADMIN_METRICS_FILE, JSON.stringify(empty, null, 2), "utf8");
    } catch {
      return memoryMetrics;
    }
    return empty;
  }
}

export async function appendAdminMetric(
  event: Omit<AdminMetricEvent, "id" | "at"> & { at?: string },
): Promise<void> {
  try {
    const file = await readAdminMetrics();
    const entry: AdminMetricEvent = {
      id: randomUUID(),
      at: event.at ?? new Date().toISOString(),
      task: event.task,
      model: event.model,
      durationMs: event.durationMs,
      ok: event.ok,
      errorCode: event.errorCode,
      errorMessage: event.errorMessage,
      promptChars: event.promptChars,
      responseChars: event.responseChars,
      historyId: event.historyId,
    };
    file.events.unshift(entry);
    if (file.events.length > MAX_EVENTS) {
      file.events = file.events.slice(0, MAX_EVENTS);
    }
    if (adminFsEnabled()) {
      await writeFile(ADMIN_METRICS_FILE, JSON.stringify(file, null, 2), "utf8");
    } else {
      memoryMetrics = file;
    }
  } catch {
    // Metrics must never break the analysis pipeline.
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

export function summarizePerformance(
  events: AdminMetricEvent[],
): AdminPerformanceSummary {
  const totalCalls = events.length;
  const okCount = events.filter((e) => e.ok).length;
  const durations = events.map((e) => e.durationMs).sort((a, b) => a - b);
  const avgDurationMs =
    durations.length === 0
      ? 0
      : Math.round(durations.reduce((s, n) => s + n, 0) / durations.length);

  const byTaskMap = new Map<
    string,
    { count: number; ok: number; durationSum: number }
  >();
  for (const event of events) {
    const row = byTaskMap.get(event.task) ?? {
      count: 0,
      ok: 0,
      durationSum: 0,
    };
    row.count += 1;
    if (event.ok) row.ok += 1;
    row.durationSum += event.durationMs;
    byTaskMap.set(event.task, row);
  }

  return {
    totalCalls,
    successRate: totalCalls === 0 ? 1 : okCount / totalCalls,
    avgDurationMs,
    p95DurationMs: percentile(durations, 95),
    byTask: [...byTaskMap.entries()].map(([task, row]) => ({
      task,
      count: row.count,
      avgDurationMs: Math.round(row.durationSum / row.count),
      successRate: row.ok / row.count,
    })),
  };
}

export function summarizeFrequentErrors(
  events: AdminMetricEvent[],
): AdminFrequentError[] {
  const failed = events.filter((e) => !e.ok);
  const map = new Map<
    string,
    { count: number; lastAt: string; sampleMessage: string; task?: string }
  >();

  for (const event of failed) {
    const key = `${event.errorCode ?? "ERROR"}::${(event.errorMessage ?? "inconnu").slice(0, 120)}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        count: 1,
        lastAt: event.at,
        sampleMessage: event.errorMessage ?? event.errorCode ?? "Erreur",
        task: event.task,
      });
    } else {
      existing.count += 1;
      if (event.at > existing.lastAt) existing.lastAt = event.at;
    }
  }

  return [...map.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
}
