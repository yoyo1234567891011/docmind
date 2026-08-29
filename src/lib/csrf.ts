import { createHash, randomBytes, timingSafeEqual } from "crypto";

import { AppError } from "@/lib/errors";
import { matchEvalApiKey } from "@/lib/auth/eval-key";

const CSRF_COOKIE = "docmind_csrf";
const CSRF_HEADER = "x-csrf-token";

/** Routes mutantes exemptées (webhook signé Stripe, cron secret). */
const CSRF_EXEMPT_PREFIXES = [
  "/api/stripe/webhook",
  "/api/billing/webhook",
  "/api/csrf",
  "/api/cron",
];

/**
 * Actions critiques : Origin/Referer + token CSRF obligatoire.
 * (suppression, export RGPD, facturation, upload, analyse)
 */
const CRITICAL_CSRF_PREFIXES = [
  "/api/account/delete",
  "/api/account/export",
  "/api/billing/",
  "/api/upload",
  "/api/analyze",
  "/api/history/",
  "/api/admin",
];

/** GET sensibles qui exigent aussi le jeton (export RGPD). */
const CRITICAL_CSRF_GET_PATHS = ["/api/account/export"];

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

export function isMutatingMethod(method: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

export function isCsrfExemptPath(pathname: string): boolean {
  return CSRF_EXEMPT_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function isCriticalCsrfPath(pathname: string): boolean {
  return CRITICAL_CSRF_PREFIXES.some((p) => {
    if (p.endsWith("/")) return pathname.startsWith(p);
    return pathname === p || pathname.startsWith(`${p}/`);
  });
}

export function assertValidOrigin(request: Request): void {
  const allowed = appOrigins();
  const origin = request.headers.get("origin")?.trim();
  if (origin) {
    if (!allowed.includes(origin)) {
      throw new AppError(
        "FORBIDDEN",
        "Origine de requête non autorisée (CSRF).",
        403,
      );
    }
    return;
  }

  const referer = request.headers.get("referer")?.trim();
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (allowed.includes(refOrigin)) return;
    } catch {
      /* fallthrough */
    }
    throw new AppError(
      "FORBIDDEN",
      "Referer de requête non autorisé (CSRF).",
      403,
    );
  }

  if (matchEvalApiKey(request.headers.get("x-eval-api-key"))) return;

  throw new AppError(
    "FORBIDDEN",
    "En-têtes Origin/Referer manquants (CSRF).",
    403,
  );
}

export function createCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashCsrfToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function csrfCookieName(): string {
  return CSRF_COOKIE;
}

export function csrfHeaderName(): string {
  return CSRF_HEADER;
}

function readCookie(request: Request, name: string): string {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]+)`),
  );
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

/** Double-submit cookie + header `x-csrf-token`. */
export function assertValidCsrfToken(request: Request): void {
  const header = request.headers.get(CSRF_HEADER)?.trim() ?? "";
  const cookie = readCookie(request, CSRF_COOKIE);

  if (!header || !cookie) {
    throw new AppError(
      "FORBIDDEN",
      "Jeton CSRF manquant. Rechargez la page et réessayez.",
      403,
    );
  }

  try {
    const a = Buffer.from(header, "utf8");
    const b = Buffer.from(cookie, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new AppError("FORBIDDEN", "Jeton CSRF invalide.", 403);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("FORBIDDEN", "Jeton CSRF invalide.", 403);
  }
}

export function enforceApiCsrf(request: Request, pathname: string): void {
  if (!pathname.startsWith("/api/")) return;
  if (isCsrfExemptPath(pathname)) return;

  const method = request.method.toUpperCase();
  const mutating = isMutatingMethod(method);
  const criticalGet = CRITICAL_CSRF_GET_PATHS.includes(pathname);

  if (!mutating && !criticalGet) return;

  if (mutating) {
    assertValidOrigin(request);
  }

  if (isCriticalCsrfPath(pathname) || criticalGet) {
    assertValidCsrfToken(request);
  }
}
