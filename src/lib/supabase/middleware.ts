import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { docmindConfig } from "@/config/docmind";
import { matchEvalApiKey } from "@/lib/auth/eval-key";
import { isSupabaseConfigured } from "@/lib/supabase/env";

const PUBLIC_PATH_PREFIXES = [
  "/auth/login",
  "/auth/signup",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/callback",
  "/auth/verify",
  "/maintenance",
  "/confidentialite",
  "/cgu",
  "/cgv",
  "/mentions-legales",
  "/api/health",
  "/api/stripe/webhook",
];

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function redirectToLogin(request: NextRequest) {
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = docmindConfig.auth.loginPath;
  redirectUrl.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(redirectUrl);
}

function unauthorizedJson() {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Authentification requise.",
      },
    },
    { status: 401 },
  );
}

/** Auth/IdP injoignable — ne pas faire croire que la session a expiré. */
function authUnavailableJson() {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: "SERVICE_UNAVAILABLE",
        message:
          "Authentification temporairement indisponible. Réessayez dans quelques minutes.",
      },
    },
    { status: 503 },
  );
}

function redirectAuthUnavailable(request: NextRequest) {
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = docmindConfig.auth.loginPath;
  redirectUrl.searchParams.set("error", "auth_unavailable");
  return NextResponse.redirect(redirectUrl);
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith("/api/");
  const isPublic = isPublicPath(pathname);

  // Dev fallback only: no Supabase → usable without auth (never in production).
  if (!isSupabaseConfigured()) {
    if (process.env.NODE_ENV === "production") {
      if (isApi) return unauthorizedJson();
      if (isPublic) return NextResponse.next({ request });
      return redirectToLogin(request);
    }
    return NextResponse.next({ request });
  }

  try {
    let supabaseResponse = NextResponse.next({
      request,
    });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    // Outage / timeout Supabase : message dédié (pas une fausse déconnexion)
    if (authError && !user && !isPublic) {
      const msg = `${authError.message} ${authError.name}`.toLowerCase();
      const unavailable =
        msg.includes("fetch") ||
        msg.includes("network") ||
        msg.includes("timeout") ||
        msg.includes("econnrefused") ||
        msg.includes("enotfound") ||
        authError.status === 503 ||
        authError.status === 502;
      if (unavailable) {
        if (isApi) return authUnavailableJson();
        return redirectAuthUnavailable(request);
      }
    }

    const hasEvalKey = matchEvalApiKey(
      request.headers.get("x-eval-api-key"),
    );

    if (!user && !hasEvalKey && !isPublic) {
      if (isApi) return unauthorizedJson();
      return redirectToLogin(request);
    }

    if (
      user &&
      (pathname === "/auth/login" || pathname === "/auth/signup")
    ) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = docmindConfig.auth.afterLoginPath;
      redirectUrl.search = "";
      return NextResponse.redirect(redirectUrl);
    }

    return supabaseResponse;
  } catch {
    if (isPublic) {
      return NextResponse.next({ request });
    }
    if (isApi) return authUnavailableJson();
    return redirectAuthUnavailable(request);
  }
}
