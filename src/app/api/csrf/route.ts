import { NextResponse } from "next/server";

import {
  createCsrfToken,
  csrfCookieName,
  csrfHeaderName,
} from "@/lib/csrf";

export const runtime = "nodejs";

/**
 * GET /api/csrf — émet un jeton double-submit (cookie + body).
 * Compatible Supabase : cookie séparé, SameSite=Lax.
 */
export async function GET() {
  const token = createCsrfToken();
  const isProd = process.env.NODE_ENV === "production";

  const response = NextResponse.json({
    success: true,
    data: {
      token,
      headerName: csrfHeaderName(),
      cookieName: csrfCookieName(),
    },
  });

  response.cookies.set(csrfCookieName(), token, {
    httpOnly: false, // lisible par le client pour le header
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  return response;
}
