import type {
  ApiResponse,
  BillingImmediateInvoice,
  BillingOverview,
  BillingPlanChangePreview,
  BillingPlanDefinition,
  PaidBillingPlanId,
} from "@/types";

import { abortSignalTimeout } from "@/lib/client/abort-signal";
import { csrfHeaders } from "@/lib/client/csrf";
import { formatClientNetworkError } from "@/lib/client/network-error";

const CHECKOUT_TIMEOUT_MS = 45_000;

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

export async function fetchPlanChangePreview(
  plan: PaidBillingPlanId,
): Promise<BillingPlanChangePreview> {
  const response = await fetch(
    `/api/billing/plan-change-preview?plan=${encodeURIComponent(plan)}`,
    { cache: "no-store" },
  );
  return parse(response);
}

export async function startPlanCheckout(
  plan: PaidBillingPlanId = "pro",
): Promise<
  | { url: string; changed?: false }
  | {
      changed: true;
      plan: PaidBillingPlanId;
      immediateInvoice: BillingImmediateInvoice | null;
      url?: undefined;
    }
> {
  let response: Response;
  try {
    response = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: await csrfHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ plan }),
      credentials: "same-origin",
      signal: abortSignalTimeout(CHECKOUT_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(
        "Le changement de plan a pris trop de temps. Réessayez ou actualisez la page.",
      );
    }
    throw new Error(formatClientNetworkError(error));
  }
  const data = await parse<
    | { url: string }
    | {
        changed: true;
        plan: PaidBillingPlanId;
        immediateInvoice?: BillingImmediateInvoice | null;
      }
    | { mode: "changed"; plan: PaidBillingPlanId }
  >(response);
  if (
    data &&
    typeof data === "object" &&
    "mode" in data &&
    data.mode === "changed" &&
    "plan" in data
  ) {
    return { changed: true as const, plan: data.plan, immediateInvoice: null };
  }
  if (
    data &&
    typeof data === "object" &&
    "changed" in data &&
    data.changed === true &&
    "plan" in data
  ) {
    return {
      changed: true as const,
      plan: data.plan,
      immediateInvoice: data.immediateInvoice ?? null,
    };
  }
  return data as
    | { url: string; changed?: false }
    | {
        changed: true;
        plan: PaidBillingPlanId;
        immediateInvoice: BillingImmediateInvoice | null;
        url?: undefined;
      };
}

/** @deprecated Prefer startPlanCheckout("pro") */
export async function startPremiumCheckout(): ReturnType<
  typeof startPlanCheckout
> {
  return startPlanCheckout("pro");
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
