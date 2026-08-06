import type { ApiResponse } from "@/types";
import type { BillingPlanId } from "@/types/billing";

export type QuotaMetric = "analyze" | "upload" | "letter" | "search";

export interface QuotaStatusItem {
  metric: QuotaMetric;
  used: number;
  limit: number;
  remaining: number;
  unlimited: boolean;
}

export interface QuotaStatus {
  plan: BillingPlanId;
  month: string;
  items: QuotaStatusItem[];
}

export async function fetchQuotas(): Promise<QuotaStatus> {
  const response = await fetch("/api/quotas", { cache: "no-store" });
  const payload = (await response.json()) as ApiResponse<QuotaStatus>;
  if (!payload.success) throw new Error(payload.error.message);
  return payload.data;
}
