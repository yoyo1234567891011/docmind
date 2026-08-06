import type {
  AlertKind,
  AlertsListResult,
  ApiResponse,
} from "@/types";

export async function fetchAlerts(options?: {
  kind?: AlertKind | "all";
  includeDismissed?: boolean;
}): Promise<AlertsListResult> {
  const params = new URLSearchParams();
  if (options?.kind && options.kind !== "all") {
    params.set("kind", options.kind);
  }
  if (options?.includeDismissed) {
    params.set("includeDismissed", "1");
  }
  const qs = params.toString();
  const response = await fetch(`/api/alerts${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
  const payload = (await response.json()) as ApiResponse<AlertsListResult>;
  if (!payload.success) throw new Error(payload.error.message);
  return payload.data;
}

export async function markAlertsAsRead(ids: string[]): Promise<void> {
  const response = await fetch("/api/alerts", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "read", ids }),
  });
  const payload = (await response.json()) as ApiResponse<unknown>;
  if (!payload.success) throw new Error(payload.error.message);
}

export async function dismissAlerts(ids: string[]): Promise<void> {
  const response = await fetch("/api/alerts", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "dismiss", ids }),
  });
  const payload = (await response.json()) as ApiResponse<unknown>;
  if (!payload.success) throw new Error(payload.error.message);
}

export async function markAllAlertsAsRead(): Promise<void> {
  const response = await fetch("/api/alerts", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "read_all" }),
  });
  const payload = (await response.json()) as ApiResponse<unknown>;
  if (!payload.success) throw new Error(payload.error.message);
}
