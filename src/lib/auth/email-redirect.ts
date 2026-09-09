/**
 * Origine utilisée dans les liens email Supabase (confirm / reset).
 * Préfère NEXT_PUBLIC_APP_URL pour rester aligné avec le dashboard Supabase.
 */
export function getAuthEmailRedirectOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://127.0.0.1:3000";
}

export function isLocalAuthOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}
