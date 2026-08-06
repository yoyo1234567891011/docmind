import type { ApiResponse } from "@/types";
import type {
  FinanceInsight,
  MemoryDigest,
  PremiumMemoryDashboard,
  RelationLetterIntent,
  SavingsOpportunity,
  SubscriptionInsight,
} from "@/types/insights";
import type { MemoryTimelineEvent } from "@/types/memory";

async function parse<T>(res: Response): Promise<T> {
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.success) {
    throw new Error(json.error?.message || "Erreur insights");
  }
  return json.data as T;
}

export async function fetchInsightsOverview(): Promise<PremiumMemoryDashboard> {
  const res = await fetch("/api/insights?view=overview", {
    cache: "no-store",
    credentials: "include",
  });
  return parse(res);
}

export async function fetchSubscriptions(): Promise<SubscriptionInsight[]> {
  const res = await fetch("/api/insights?view=subscriptions", {
    cache: "no-store",
    credentials: "include",
  });
  const data = await parse<{ subscriptions: SubscriptionInsight[] }>(res);
  return data.subscriptions;
}

export async function fetchFinanceInsight(): Promise<FinanceInsight> {
  const res = await fetch("/api/insights?view=finance", {
    cache: "no-store",
    credentials: "include",
  });
  return parse(res);
}

export async function fetchSavings(): Promise<SavingsOpportunity[]> {
  const res = await fetch("/api/insights?view=savings", {
    cache: "no-store",
    credentials: "include",
  });
  const data = await parse<{ savings: SavingsOpportunity[] }>(res);
  return data.savings;
}

export async function fetchDigest(
  period: "week" | "month" = "week",
): Promise<MemoryDigest> {
  const res = await fetch(`/api/insights?view=digest&period=${period}`, {
    cache: "no-store",
    credentials: "include",
  });
  return parse(res);
}

export async function fetchLetterIntents(): Promise<RelationLetterIntent[]> {
  const res = await fetch("/api/insights?view=letters", {
    cache: "no-store",
    credentials: "include",
  });
  const data = await parse<{ intents: RelationLetterIntent[] }>(res);
  return data.intents;
}

export async function fetchEntityTimeline(
  entityId: string,
): Promise<MemoryTimelineEvent[]> {
  const res = await fetch(
    `/api/insights?view=timeline&entityId=${encodeURIComponent(entityId)}`,
    { cache: "no-store", credentials: "include" },
  );
  const data = await parse<{ entityId: string; events: MemoryTimelineEvent[] }>(
    res,
  );
  return data.events;
}
