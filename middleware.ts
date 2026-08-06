import { NextResponse, type NextRequest } from "next/server";

import { checkApiCsrfEdge } from "@/lib/csrf-edge";
import { maybeMaintenanceResponse } from "@/lib/maintenance";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const maintenance = maybeMaintenanceResponse(request);
  if (maintenance) return maintenance;

  const csrf = checkApiCsrfEdge(request);
  if (!csrf.ok) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: csrf.message },
      },
      { status: csrf.status },
    );
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
