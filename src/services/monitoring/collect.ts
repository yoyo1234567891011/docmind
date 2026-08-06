import { getOllamaBaseUrl } from "@/ai/models/config";
import { getOllamaGenerateLockState } from "@/ai/models/generate-lock";
import { normalizeOllamaBaseUrl } from "@/ai/models/ollama-http";
import {
  appendMonitoringAlert,
  listMonitoringAlerts,
  listMonitoringEvents,
  saveMonitoringSnapshot,
  type MonitoringSnapshot,
} from "@/services/monitoring/store";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx] ?? 0;
}

async function probeOllama(): Promise<{
  up: boolean;
  gpuUtil: number | null;
  model: string | null;
}> {
  const base = normalizeOllamaBaseUrl(getOllamaBaseUrl());
  try {
    const tags = await fetch(`${base}/api/tags`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_500),
    });
    if (!tags.ok) return { up: false, gpuUtil: null, model: null };

    let model: string | null = null;
    let gpuUtil: number | null = null;
    try {
      const ps = await fetch(`${base}/api/ps`, {
        cache: "no-store",
        signal: AbortSignal.timeout(2_500),
      });
      if (ps.ok) {
        const body = (await ps.json()) as {
          models?: Array<{
            name?: string;
            size_vram?: number;
            size?: number;
          }>;
        };
        const first = body.models?.[0];
        model = first?.name ?? null;
        if (first?.size_vram && first?.size) {
          gpuUtil = Math.min(
            100,
            Math.round((first.size_vram / first.size) * 100),
          );
        } else if (body.models && body.models.length > 0) {
          gpuUtil = 50; // modèle chargé = activité GPU indicative
        } else {
          gpuUtil = 0;
        }
      }
    } catch {
      // /api/ps optionnel
    }
    return { up: true, gpuUtil, model };
  } catch {
    return { up: false, gpuUtil: null, model: null };
  }
}

export async function buildMonitoringSnapshot(
  windowMs = 24 * 60 * 60 * 1000,
): Promise<MonitoringSnapshot> {
  const events = await listMonitoringEvents(windowMs);
  const analysisOk = events.filter((e) => e.name === "analysis.ok");
  const analysisErr = events.filter((e) => e.name === "analysis.error");
  const waits = events
    .filter((e) => e.name === "queue.wait")
    .map((e) => Number(e.meta?.waitMs ?? 0))
    .filter((n) => Number.isFinite(n) && n >= 0);

  const durations = analysisOk
    .map((e) => Number(e.meta?.durationMs ?? 0))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  const total = analysisOk.length + analysisErr.length;
  const lock = getOllamaGenerateLockState();
  const ollama = await probeOllama();
  const alerts = await listMonitoringAlerts();
  const openAlerts = alerts.filter((a) => !a.resolved).length;

  const serverErrors = events.filter((e) => e.name === "server.error");

  return {
    at: new Date().toISOString(),
    analysis: {
      count: total,
      successRate: total === 0 ? 1 : analysisOk.length / total,
      avgDurationMs:
        durations.length === 0
          ? 0
          : Math.round(
              durations.reduce((a, b) => a + b, 0) / durations.length,
            ),
      p95DurationMs: Math.round(percentile(durations, 95)),
      avgWaitMs:
        waits.length === 0
          ? 0
          : Math.round(waits.reduce((a, b) => a + b, 0) / waits.length),
    },
    workers: {
      ollamaUp: ollama.up,
      activeGenerations: lock.activeCount,
      activeKey: lock.activeKey,
    },
    gpu: {
      available: ollama.up,
      utilizationPercent: ollama.gpuUtil,
      model: ollama.model,
    },
    serverErrors24h: serverErrors.length,
    alertsOpen: openAlerts,
  };
}

export interface MonitoringThresholds {
  minSuccessRate: number;
  maxAvgDurationMs: number;
  maxAvgWaitMs: number;
  requireOllama: boolean;
}

export function defaultThresholds(): MonitoringThresholds {
  return {
    minSuccessRate: Number(process.env.MONITOR_MIN_SUCCESS_RATE ?? "0.5"),
    maxAvgDurationMs: Number(process.env.MONITOR_MAX_AVG_DURATION_MS ?? "300000"),
    maxAvgWaitMs: Number(process.env.MONITOR_MAX_AVG_WAIT_MS ?? "120000"),
    requireOllama: process.env.MONITOR_REQUIRE_OLLAMA !== "0",
  };
}

/**
 * Évalue les seuils, enregistre alertes, snapshot, webhook optionnel.
 */
export async function runMonitoringCheck(): Promise<{
  snapshot: MonitoringSnapshot;
  newAlerts: string[];
}> {
  const snapshot = await buildMonitoringSnapshot();
  await saveMonitoringSnapshot(snapshot);
  const thresholds = defaultThresholds();
  const newAlerts: string[] = [];

  if (thresholds.requireOllama && !snapshot.workers.ollamaUp) {
    const a = await appendMonitoringAlert({
      severity: "critical",
      code: "OLLAMA_DOWN",
      message: "Ollama inaccessible — analyses impossibles.",
    });
    newAlerts.push(a.code);
  }

  if (
    snapshot.analysis.count >= 5 &&
    snapshot.analysis.successRate < thresholds.minSuccessRate
  ) {
    const a = await appendMonitoringAlert({
      severity: "critical",
      code: "LOW_SUCCESS_RATE",
      message: `Taux de réussite analyses ${(snapshot.analysis.successRate * 100).toFixed(1)}% < ${(thresholds.minSuccessRate * 100).toFixed(0)}%.`,
    });
    newAlerts.push(a.code);
  }

  if (
    snapshot.analysis.count >= 3 &&
    snapshot.analysis.avgDurationMs > thresholds.maxAvgDurationMs
  ) {
    const a = await appendMonitoringAlert({
      severity: "warning",
      code: "SLOW_ANALYSIS",
      message: `Durée moyenne analyses ${snapshot.analysis.avgDurationMs}ms au-dessus du seuil.`,
    });
    newAlerts.push(a.code);
  }

  if (
    snapshot.analysis.avgWaitMs > thresholds.maxAvgWaitMs &&
    snapshot.analysis.avgWaitMs > 0
  ) {
    const a = await appendMonitoringAlert({
      severity: "warning",
      code: "HIGH_QUEUE_WAIT",
      message: `Attente moyenne file Ollama ${snapshot.analysis.avgWaitMs}ms.`,
    });
    newAlerts.push(a.code);
  }

  const maxServerErrors = Number(process.env.MONITOR_MAX_SERVER_ERRORS ?? "20");
  if (snapshot.serverErrors24h >= maxServerErrors) {
    const a = await appendMonitoringAlert({
      severity: "critical",
      code: "SERVER_ERRORS",
      message: `${snapshot.serverErrors24h} erreurs serveur (5xx) sur 24h.`,
    });
    newAlerts.push(a.code);
  }

  const webhook = process.env.MONITORING_WEBHOOK_URL?.trim();
  if (webhook && newAlerts.length > 0) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "docmind-monitoring",
          alerts: newAlerts,
          snapshot,
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // best-effort
    }
  }

  return { snapshot, newAlerts };
}
