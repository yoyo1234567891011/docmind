import type {
  AdminFrequentError,
  AdminMetricEvent,
  AdminPerformanceSummary,
  AdminPromptKey,
  AdminPromptVersion,
  AdminPromptsFile,
  AdminRuntimeConfig,
} from "@/types/admin";
import type { AnalyticsProductSummary } from "@/types/analytics";
import type { ProductionDashboard } from "@/types/production";
import type { HistoryRecord } from "@/types";

import { csrfHeaders } from "@/lib/client/csrf";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string };
}

async function parseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !payload.success || payload.data === undefined) {
    throw new Error(payload.error?.message || "Erreur Admin API");
  }
  return payload.data;
}

export interface AdminDashboardData {
  config: AdminRuntimeConfig;
  prompts: AdminPromptsFile;
  models: string[];
  performance: AdminPerformanceSummary;
  frequentErrors: AdminFrequentError[];
  recentEvents: AdminMetricEvent[];
  productAnalytics?: AnalyticsProductSummary;
  modelProfiles?: {
    active: string;
    runtime: string;
    profiles: Array<{
      id: string;
      label: string;
      description: string;
      chat: string;
      embed: string;
    }>;
  };
}

export async function fetchAdminDashboard(): Promise<AdminDashboardData> {
  const response = await fetch("/api/admin", { cache: "no-store" });
  return parseJson<AdminDashboardData>(response);
}

export async function patchAdminConfig(
  patch: {
    ollamaBaseUrl?: string;
    embedModel?: string;
    tasks?: AdminRuntimeConfig["tasks"];
    activePrompts?: AdminRuntimeConfig["activePrompts"];
    profileId?: string;
  },
): Promise<AdminRuntimeConfig> {
  const response = await fetch("/api/admin/config", {
    method: "PATCH",
    headers: await csrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
    credentials: "same-origin",
  });
  const data = await parseJson<{ config: AdminRuntimeConfig }>(response);
  return data.config;
}

export async function saveAdminPrompt(input: {
  key: AdminPromptKey;
  label: string;
  content: string;
  note?: string;
  parentId?: string | null;
  activate?: boolean;
}): Promise<AdminPromptVersion> {
  const response = await fetch("/api/admin/prompts", {
    method: "POST",
    headers: await csrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
    credentials: "same-origin",
  });
  const data = await parseJson<{ version: AdminPromptVersion }>(response);
  return data.version;
}

export async function rollbackAdminPrompt(
  versionId: string,
): Promise<AdminPromptVersion> {
  const response = await fetch("/api/admin/prompts", {
    method: "POST",
    headers: await csrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action: "rollback", versionId }),
    credentials: "same-origin",
  });
  const data = await parseJson<{ version: AdminPromptVersion }>(response);
  return data.version;
}

export async function deleteAdminPrompt(id: string): Promise<void> {
  const response = await fetch(`/api/admin/prompts?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await csrfHeaders(),
    credentials: "same-origin",
  });
  await parseJson<{ deleted: boolean }>(response);
}

export async function compareAdminPrompts(input: {
  versionIdA: string;
  versionIdB: string;
  mode: "diff" | "run";
  sampleText?: string;
  key?: AdminPromptKey;
}): Promise<Record<string, unknown>> {
  const response = await fetch("/api/admin/compare", {
    method: "POST",
    headers: await csrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
    credentials: "same-origin",
  });
  return parseJson(response);
}

export interface AdminMonitoringSnapshot {
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
  serverErrors24h: number;
  alertsOpen: number;
}

export interface AdminMonitoringAlert {
  id: string;
  at: string;
  severity: "warning" | "critical";
  code: string;
  message: string;
  resolved?: boolean;
}

export async function fetchAdminMonitoring(): Promise<{
  snapshot: AdminMonitoringSnapshot;
  alerts: AdminMonitoringAlert[];
}> {
  const response = await fetch("/api/admin/monitoring", { cache: "no-store" });
  return parseJson(response);
}

export async function runAdminMonitoringCheck(): Promise<{
  snapshot: AdminMonitoringSnapshot;
  newAlerts: string[];
  alerts: AdminMonitoringAlert[];
}> {
  const response = await fetch("/api/admin/monitoring", {
    method: "POST",
    headers: await csrfHeaders(),
    credentials: "same-origin",
  });
  return parseJson(response);
}

export type { ProductionDashboard };

export async function fetchAdminProduction(): Promise<ProductionDashboard> {
  const response = await fetch("/api/admin/production", { cache: "no-store" });
  return parseJson<ProductionDashboard>(response);
}

export async function reanalyzeAdminDocument(
  historyId: string,
  skipReadyReply = false,
): Promise<HistoryRecord> {
  const response = await fetch("/api/admin/reanalyze", {
    method: "POST",
    headers: await csrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ historyId, skipReadyReply }),
    credentials: "same-origin",
  });
  const data = await parseJson<{ record: HistoryRecord }>(response);
  return data.record;
}
