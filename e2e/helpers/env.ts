export function hasSupabaseEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
  );
}

export function playwrightCredentials(): {
  email: string;
  password: string;
} | null {
  const email = process.env.PLAYWRIGHT_EMAIL?.trim();
  const password = process.env.PLAYWRIGHT_PASSWORD?.trim();
  if (!email || !password) return null;
  return { email, password };
}

export function evalApiKey(): string | null {
  return process.env.EVAL_API_KEY?.trim() || null;
}

export function requireOllama(): boolean {
  if (process.env.E2E_REQUIRE_OLLAMA === "1") return true;
  if (process.env.E2E_REQUIRE_OLLAMA === "0") return false;
  // CI : le cœur produit (analyse / mémoire / courrier) ne doit pas skip en silence.
  const ci = process.env.CI?.trim().toLowerCase();
  return ci === "true" || ci === "1";
}
