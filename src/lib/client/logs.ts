import type { PublicAnalysisLogEntry } from "@/types";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string };
}

export async function fetchAnalysisLogs(options?: {
  limit?: number;
  errorsOnly?: boolean;
  category?: string;
}): Promise<{
  total: number;
  entries: PublicAnalysisLogEntry[];
  sanitized?: boolean;
}> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.errorsOnly) params.set("errors", "1");
  if (options?.category && options.category !== "all") {
    params.set("category", options.category);
  }
  const qs = params.toString();
  const response = await fetch(`/api/logs${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
  const payload = (await response.json()) as ApiEnvelope<{
    total: number;
    entries: PublicAnalysisLogEntry[];
    sanitized?: boolean;
  }>;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error?.message || "Impossible de charger les logs");
  }
  return payload.data;
}
