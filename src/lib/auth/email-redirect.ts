/**
 * Origine utilisée dans les liens email Supabase (confirm / reset).
 * Toujours une URL ABSOLUE. Préfère NEXT_PUBLIC_APP_URL (prod = xn--chlia-9rac.com).
 */
export function getAuthEmailRedirectOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (fromEnv) {
    try {
      return new URL(fromEnv).origin;
    } catch {
      /* fallthrough */
    }
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://127.0.0.1:3000";
}

/** emailRedirectTo / redirectTo absolu vers une route auth existante. */
export function getAuthEmailRedirectTo(path = "/auth/callback"): string {
  const origin = getAuthEmailRedirectOrigin();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${normalized}`;
}

export function isLocalAuthOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}
