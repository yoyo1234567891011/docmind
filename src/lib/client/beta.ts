interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error?.message || "Envoi impossible");
  }
  return payload.data;
}

export async function submitFeedback(input: {
  category: string;
  rating?: number | null;
  message: string;
  page?: string | null;
}): Promise<{ id: string }> {
  return postJson("/api/feedback", input);
}

export async function submitErrorReport(input: {
  kind: string;
  severity?: string;
  message: string;
  page?: string | null;
  errorCode?: string | null;
  errorDetail?: string | null;
}): Promise<{ id: string }> {
  return postJson("/api/reports", input);
}

export function buildReportHref(options: {
  message?: string;
  detail?: string;
  code?: string;
  kind?: string;
}): string {
  const params = new URLSearchParams();
  if (options.kind) params.set("kind", options.kind);
  if (options.message) params.set("message", options.message.slice(0, 400));
  if (options.detail) params.set("detail", options.detail.slice(0, 400));
  if (options.code) params.set("code", options.code);
  const qs = params.toString();
  return qs ? `/signalement?${qs}` : "/signalement";
}
