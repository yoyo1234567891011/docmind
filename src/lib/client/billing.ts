import type {
  ApiResponse,
  BillingOverview,
  BillingPlanDefinition,
} from "@/types";

import { csrfHeaders } from "@/lib/client/csrf";

export type BillingApiResponse = BillingOverview & {
  plans: BillingPlanDefinition[];
};

async function parse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiResponse<T>;
  if (!payload.success) throw new Error(payload.error.message);
  return payload.data;
}

export async function fetchBilling(): Promise<BillingApiResponse> {
  const response = await fetch("/api/billing", { cache: "no-store" });
  return parse(response);
}

export async function syncBilling(options?: {
  sessionId?: string | null;
}): Promise<BillingApiResponse & { synced: boolean; syncSource: string }> {
  const response = await fetch("/api/billing/sync", {
    method: "POST",
    headers: await csrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ sessionId: options?.sessionId ?? null }),
    credentials: "same-origin",
  });
  return parse(response);
}

export async function startPremiumCheckout(): Promise<{ url: string }> {
  const response = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: await csrfHeaders(),
    credentials: "same-origin",
  });
  return parse(response);
}

export async function openBillingPortal(): Promise<{ url: string }> {
  const response = await fetch("/api/billing/portal", {
    method: "POST",
    headers: await csrfHeaders(),
    credentials: "same-origin",
  });
  return parse(response);
}

export async function cancelSubscription(options?: {
  immediately?: boolean;
}): Promise<{ cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null }> {
  const response = await fetch("/api/billing/cancel", {
    method: "POST",
    headers: await csrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ immediately: options?.immediately ?? false }),
    credentials: "same-origin",
  });
  return parse(response);
}

export async function resumeSubscription(): Promise<{ resumed: boolean }> {
  const response = await fetch("/api/billing/cancel", {
    method: "POST",
    headers: await csrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ resume: true }),
    credentials: "same-origin",
  });
  return parse(response);
}
