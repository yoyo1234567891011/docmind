import { createBrowserClient } from "@supabase/ssr";

import {
  getSupabaseAnonKey,
  getSupabaseUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/env";

export function createClient() {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase non configuré. Renseignez NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY dans .env.local",
    );
  }

  return createBrowserClient(getSupabaseUrl()!, getSupabaseAnonKey()!);
}
