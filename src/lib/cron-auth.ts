import { timingSafeEqual } from "crypto";

import { AppError } from "@/lib/errors";

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Auth cron/drain : Authorization Bearer CRON_SECRET
 * ou header x-cron-secret.
 */
export function assertCronAuthorized(request: Request): void {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "CRON_SECRET non configuré — drain désactivé.",
      503,
    );
  }

  const auth = request.headers.get("authorization")?.trim() ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const header = request.headers.get("x-cron-secret")?.trim() ?? "";
  const provided = bearer || header;
  if (!provided || !safeEqual(provided, secret)) {
    throw new AppError("UNAUTHORIZED", "Secret cron invalide.", 401);
  }
}
