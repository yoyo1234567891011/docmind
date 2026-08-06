import type { ClientAnalyticsEventName } from "@/types/analytics";
import { sanitizeAnalyticsPathname } from "@/lib/analytics-pathname";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string };
}

export async function trackClientAnalytics(
  name: ClientAnalyticsEventName,
  meta?: Record<string, string | number | boolean | null>,
): Promise<void> {
  try {
    const safeMeta = { ...meta };
    if (typeof safeMeta.pathname === "string") {
      safeMeta.pathname = sanitizeAnalyticsPathname(safeMeta.pathname);
    }
    // Jamais d’email / contenu document côté client analytics
    delete safeMeta.email;
    delete safeMeta.text;
    delete safeMeta.fileName;

    const response = await fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        meta: {
          ...safeMeta,
          clientTs: new Date().toISOString(),
          source: safeMeta.source ?? "client",
        },
      }),
    });
    if (!response.ok) return;
    const payload = (await response.json()) as ApiEnvelope<{ ok: boolean }>;
    if (!payload.success) return;
  } catch {
    // Never block UX on analytics
  }
}
