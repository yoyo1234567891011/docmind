import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import {
  getSupabaseAnonKey,
  getSupabaseUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/env";

export async function createClient() {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase non configuré. Renseignez NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY dans .env.local",
    );
  }

  const cookieStore = await cookies();
  const url = getSupabaseUrl()!;
  const key = getSupabaseAnonKey()!;

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — middleware refreshes sessions.
        }
      },
    },
  });
}
