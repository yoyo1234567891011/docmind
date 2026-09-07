import { NextResponse } from "next/server";

import { docmindConfig } from "@/config/docmind";
import { safeNextPath } from "@/lib/safe-redirect";
import {
  isSupabaseConfigured,
  LOCAL_DEV_USER_ID,
} from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { resolvePostLoginPath } from "@/services/onboarding/guide";

/**
 * Point unique post-auth :
 * - 1ʳᵉ visite authentifiée → /guide
 * - sinon → next (dashboard / deep link)
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const requestedNext = safeNextPath(
    searchParams.get("next"),
    docmindConfig.auth.afterLoginPath,
  );

  let userId: string | null = null;

  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      userId = LOCAL_DEV_USER_ID;
    }
  } else {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  }

  if (!userId) {
    const login = new URL(docmindConfig.auth.loginPath, origin);
    login.searchParams.set("next", requestedNext);
    return NextResponse.redirect(login);
  }

  const destination = await resolvePostLoginPath(userId, requestedNext);
  return NextResponse.redirect(`${origin}${destination}`);
}
