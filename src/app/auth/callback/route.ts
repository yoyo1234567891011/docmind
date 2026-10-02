import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { docmindConfig } from "@/config/docmind";
import { safeNextPath } from "@/lib/safe-redirect";
import {
  getSupabaseAnonKey,
  getSupabaseUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/env";
import { trackAnalyticsEvent } from "@/services/analytics";

/**
 * Confirme le lien e-mail / OAuth :
 * - PKCE : ?code=
 * - liens e-mail Supabase : ?token_hash= + type=
 * Cookies de session attachés à la réponse redirect (requis SSR).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNextPath(
    searchParams.get("next"),
    docmindConfig.auth.afterLoginPath,
  );

  const failRedirect = (reason: string) => {
    const login = request.nextUrl.clone();
    login.pathname = docmindConfig.auth.loginPath;
    login.search = "";
    login.searchParams.set("error", reason);
    login.searchParams.set("next", next);
    return NextResponse.redirect(login);
  };

  if (!isSupabaseConfigured()) {
    return failRedirect("supabase_config");
  }

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const oauthError = searchParams.get("error");

  if (oauthError || (!code && !tokenHash)) {
    return failRedirect("auth_callback");
  }

  // Redirect créé d’abord — les cookies session y sont écrits (pattern SSR).
  const redirectResponse = NextResponse.redirect(
    new URL(
      `/auth/continue?next=${encodeURIComponent(next)}`,
      origin,
    ),
  );

  const supabase = createServerClient(
    getSupabaseUrl()!,
    getSupabaseAnonKey()!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            redirectResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return failRedirect("auth_callback");
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as
        | "signup"
        | "invite"
        | "magiclink"
        | "recovery"
        | "email_change"
        | "email",
      token_hash: tokenHash,
    });
    if (error) return failRedirect("auth_callback");
  } else {
    return failRedirect("auth_callback");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  await trackAnalyticsEvent({
    name: "auth.login",
    userId: user?.id ?? null,
    meta: {
      provider: "email_link",
      source: "auth_callback",
    },
  }).catch(() => undefined);

  return redirectResponse;
}
