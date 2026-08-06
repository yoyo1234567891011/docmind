/**
 * Supabase env helpers — shared by middleware (Edge) and server code.
 */

export function getSupabaseUrl(): string | undefined {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  return value || undefined;
}

export function getSupabaseAnonKey(): string | undefined {
  const value = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return value || undefined;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

/** Stable local user when auth is not configured (dev fallback). */
export const LOCAL_DEV_USER_ID = "local-dev";
