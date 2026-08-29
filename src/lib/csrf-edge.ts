/**
 * CSRF pour middleware Edge (pas de crypto Node).
 */

const CSRF_COOKIE = "docmind_csrf";
const CSRF_HEADER = "x-csrf-token";

/** Aligné sur src/lib/csrf.ts — webhook signé, CSRF bootstrap, cron Bearer. */
const EXEMPT = [
  "/api/stripe/webhook",
  "/api/billing/webhook",
  "/api/csrf",
  "/api/cron",
];

const CRITICAL = [
  "/api/account/delete",
  "/api/account/export",
  "/api/billing/",
  "/api/upload",
  "/api/analyze",
  "/api/history/",
  "/api/admin",
];

const CRITICAL_GET = ["/api/account/export"];

function appOrigins(): string[] {
  const origins = new Set<string>();
  for (const raw of [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.EVAL_BASE_URL,
  ]) {
    const value = raw?.trim();
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      /* ignore */
    }
  }
  origins.add("http://127.0.0.1:3000");
  origins.add("http://localhost:3000");
  return [...origins];
}

function isMutating(method: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

function isExempt(pathname: string): boolean {
  return EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isCritical(pathname: string): boolean {
  return CRITICAL.some((p) => {
    if (p.endsWith("/")) return pathname.startsWith(p);
    return pathname === p || pathname.startsWith(`${p}/`);
  });
}

function readCookie(cookieHeader: string | null, name: string): string {
  if (!cookieHeader) return "";
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]+)`),
  );
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function evalKeyAllowed(requestHeaders: Headers): boolean {
  const evalKey = process.env.EVAL_API_KEY?.trim();
  const provided = requestHeaders.get("x-eval-api-key")?.trim();
  if (!evalKey || !provided || evalKey !== provided) return false;
  const env = (
    process.env.NEXT_PUBLIC_APP_ENV ||
    process.env.NODE_ENV ||
    ""
  ).toLowerCase();
  const deployed =
    env === "production" || env === "beta" || env === "staging";
  if (deployed && process.env.EVAL_ALLOW_IN_DEPLOY !== "1") return false;
  return true;
}

export type CsrfCheckResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

export function checkApiCsrfEdge(request: {
  method: string;
  nextUrl: { pathname: string };
  headers: Headers;
}): CsrfCheckResult {
  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith("/api/")) return { ok: true };
  if (isExempt(pathname)) return { ok: true };

  const method = request.method.toUpperCase();
  const mutating = isMutating(method);
  const criticalGet = CRITICAL_GET.includes(pathname);
  if (!mutating && !criticalGet) return { ok: true };

  const allowed = appOrigins();
  const evalOk = evalKeyAllowed(request.headers);
  const origin = request.headers.get("origin")?.trim();

  if (mutating) {
    if (origin) {
      if (!allowed.includes(origin) && !evalOk) {
        return {
          ok: false,
          status: 403,
          message: "Origine de requête non autorisée (CSRF).",
        };
      }
    } else {
      const referer = request.headers.get("referer")?.trim();
      if (referer) {
        try {
          const refOrigin = new URL(referer).origin;
          if (!allowed.includes(refOrigin) && !evalOk) {
            return {
              ok: false,
              status: 403,
              message: "Referer de requête non autorisé (CSRF).",
            };
          }
        } catch {
          return {
            ok: false,
            status: 403,
            message: "Referer de requête non autorisé (CSRF).",
          };
        }
      } else if (!evalOk) {
        return {
          ok: false,
          status: 403,
          message: "En-têtes Origin/Referer manquants (CSRF).",
        };
      }
    }
  }

  if ((isCritical(pathname) || criticalGet) && !evalOk) {
    const header = request.headers.get(CSRF_HEADER)?.trim() ?? "";
    const cookie = readCookie(request.headers.get("cookie"), CSRF_COOKIE);
    if (!header || !cookie || header !== cookie) {
      return {
        ok: false,
        status: 403,
        message: "Jeton CSRF manquant ou invalide. Rechargez la page.",
      };
    }
  }

  return { ok: true };
}
