import { NextResponse, type NextRequest } from "next/server";

import {
  getMaintenanceBypassSecret,
  getMaintenanceMessage,
  isMaintenanceMode,
} from "@/config/runtime";

const BYPASS_COOKIE = "docmind_maint_bypass";

const MAINTENANCE_ALLOW_PREFIXES = [
  "/maintenance",
  "/api/health",
  "/api/stripe/webhook",
  "/auth/",
  "/_next/",
];

function isAllowedDuringMaintenance(pathname: string): boolean {
  return MAINTENANCE_ALLOW_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  );
}

function hasValidBypass(request: NextRequest): boolean {
  const secret = getMaintenanceBypassSecret();
  if (!secret) return false;

  const cookie = request.cookies.get(BYPASS_COOKIE)?.value;
  if (cookie && cookie === secret) return true;

  const fromQuery = request.nextUrl.searchParams.get("maintenance_bypass");
  return Boolean(fromQuery && fromQuery === secret);
}

/**
 * Si maintenance active : 503 API / redirect page, sauf chemins autorisés ou bypass.
 * Retourne une Response à court-circuiter, ou null pour continuer.
 */
export function maybeMaintenanceResponse(
  request: NextRequest,
): NextResponse | null {
  if (!isMaintenanceMode()) return null;

  const { pathname } = request.nextUrl;
  if (isAllowedDuringMaintenance(pathname)) return null;
  if (hasValidBypass(request)) {
    // Pose le cookie si bypass via query
    const secret = getMaintenanceBypassSecret();
    const fromQuery = request.nextUrl.searchParams.get("maintenance_bypass");
    if (secret && fromQuery === secret) {
      const url = request.nextUrl.clone();
      url.searchParams.delete("maintenance_bypass");
      const res = NextResponse.redirect(url);
      res.cookies.set(BYPASS_COOKIE, secret, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 12,
      });
      return res;
    }
    return null;
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: getMaintenanceMessage(),
        },
      },
      { status: 503 },
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = "/maintenance";
  url.search = "";
  return NextResponse.redirect(url);
}
