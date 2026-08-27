import type { ApiResponse } from "@/types";
import type {
  MemoryCounterpartyAggregate,
  MemoryTimelineEvent,
} from "@/types/memory";

export type TimelineEvent = MemoryTimelineEvent;
export type CounterpartyAggregate = MemoryCounterpartyAggregate;

async function parse<T>(res: Response): Promise<T> {
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.success) {
    throw new Error(json.error?.message || "Erreur mémoire");
  }
  return json.data as T;
}

export async function fetchDocumentTimeline(
  documentId: string,
): Promise<{
  documentId: string;
  entityIds: string[];
  events: TimelineEvent[];
}> {
  const res = await fetch(
    `/api/memory/timeline?documentId=${encodeURIComponent(documentId)}`,
    { credentials: "include", cache: "no-store" },
  );
  return parse(res);
}

export async function fetchCounterparties(): Promise<{
  counterparties: CounterpartyAggregate[];
}> {
  const res = await fetch("/api/memory/timeline?view=counterparties", {
    credentials: "include",
    cache: "no-store",
  });
  return parse(res);
}
