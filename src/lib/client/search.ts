import type { ApiResponse, SmartSearchRequest, SmartSearchResult } from "@/types";

export async function smartSearch(
  request: SmartSearchRequest,
): Promise<SmartSearchResult> {
  const response = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  const payload = (await response.json()) as ApiResponse<SmartSearchResult>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}
