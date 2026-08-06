import { mkdir, readFile, writeFile } from "fs/promises";
import { randomUUID } from "crypto";

import {
  MONITORING_ALERTS_FILE,
  MONITORING_DIR,
  MONITORING_EVENTS_FILE,
  MONITORING_SNAPSHOT_FILE,
} from "@/config/paths";

export type MonitoringEventName =
  | "analysis.ok"
  | "analysis.error"
  | "server.error"
  | "queue.wait"
  | "gpu.sample"
  | "worker.sample";

export interface MonitoringEvent {
  id: string;
  at: string;
  name: MonitoringEventName;
  userId?: string;
  meta?: Record<string, unknown>;
}

export interface MonitoringAlert {
  id: string;
  at: string;
  severity: "warning" | "critical";
  code: string;
  message: string;
  resolved?: boolean;
}

export interface MonitoringSnapshot {
  at: string;
  analysis: {
    count: number;
    successRate: number;
    avgDurationMs: number;
    p95DurationMs: number;
    avgWaitMs: number;
  };
  workers: {
    ollamaUp: boolean;
    activeGenerations: number;
    activeKey: string | null;
  };
  gpu: {
    available: boolean;
    utilizationPercent: number | null;
    model?: string | null;
  };
  /** Erreurs serveur 5xx enregistrées sur la fenêtre. */
  serverErrors24h: number;
  alertsOpen: number;
}

const MAX_EVENTS = 5_000;
const MAX_ALERTS = 500;

async function ensureDir(): Promise<void> {
  await mkdir(MONITORING_DIR, { recursive: true });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function appendMonitoringEvent(
  event: Omit<MonitoringEvent, "id" | "at"> & { at?: string },
): Promise<void> {
  await ensureDir();
  const file = await readJson<{ events: MonitoringEvent[] }>(
    MONITORING_EVENTS_FILE,
    { events: [] },
  );
  file.events.push({
    id: randomUUID(),
    at: event.at ?? new Date().toISOString(),
    name: event.name,
    userId: event.userId,
    meta: event.meta,
  });
  if (file.events.length > MAX_EVENTS) {
    file.events = file.events.slice(-MAX_EVENTS);
  }
  await writeFile(MONITORING_EVENTS_FILE, JSON.stringify(file, null, 2), "utf8");
}

/** RGPD Art. 17 — retire userId des événements monitoring. */
export async function anonymizeMonitoringForUser(
  userId: string,
): Promise<{ updated: number }> {
  await ensureDir();
  const file = await readJson<{ events: MonitoringEvent[] }>(
    MONITORING_EVENTS_FILE,
    { events: [] },
  );
  let updated = 0;
  for (const event of file.events) {
    if (event.userId === userId) {
      delete event.userId;
      updated += 1;
    }
  }
  if (updated > 0) {
    await writeFile(
      MONITORING_EVENTS_FILE,
      JSON.stringify(file, null, 2),
      "utf8",
    );
  }
  return { updated };
}

export async function appendMonitoringAlert(
  alert: Omit<MonitoringAlert, "id" | "at">,
): Promise<MonitoringAlert> {
  await ensureDir();
  const file = await readJson<{ alerts: MonitoringAlert[] }>(
    MONITORING_ALERTS_FILE,
    { alerts: [] },
  );
  const entry: MonitoringAlert = {
    id: randomUUID(),
    at: new Date().toISOString(),
    ...alert,
  };
  file.alerts.push(entry);
  if (file.alerts.length > MAX_ALERTS) {
    file.alerts = file.alerts.slice(-MAX_ALERTS);
  }
  await writeFile(MONITORING_ALERTS_FILE, JSON.stringify(file, null, 2), "utf8");
  return entry;
}

export async function listMonitoringEvents(
  sinceMs = 24 * 60 * 60 * 1000,
): Promise<MonitoringEvent[]> {
  const file = await readJson<{ events: MonitoringEvent[] }>(
    MONITORING_EVENTS_FILE,
    { events: [] },
  );
  const cutoff = Date.now() - sinceMs;
  return file.events.filter((e) => Date.parse(e.at) >= cutoff);
}

export async function listMonitoringAlerts(): Promise<MonitoringAlert[]> {
  const file = await readJson<{ alerts: MonitoringAlert[] }>(
    MONITORING_ALERTS_FILE,
    { alerts: [] },
  );
  return file.alerts;
}

export async function saveMonitoringSnapshot(
  snapshot: MonitoringSnapshot,
): Promise<void> {
  await ensureDir();
  await writeFile(
    MONITORING_SNAPSHOT_FILE,
    JSON.stringify(snapshot, null, 2),
    "utf8",
  );
}

export async function readMonitoringSnapshot(): Promise<MonitoringSnapshot | null> {
  try {
    return JSON.parse(
      await readFile(MONITORING_SNAPSHOT_FILE, "utf8"),
    ) as MonitoringSnapshot;
  } catch {
    return null;
  }
}
