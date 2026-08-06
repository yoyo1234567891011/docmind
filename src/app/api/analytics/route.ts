import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { getOptionalUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { sanitizeAnalyticsPathname } from "@/lib/analytics-pathname";
import {
  isAnalyticsEventName,
  trackAnalyticsEvent,
} from "@/services/analytics";
import { CLIENT_ANALYTICS_EVENT_NAMES } from "@/types/analytics";

export const runtime = "nodejs";

const CLIENT_ALLOWED = new Set<string>(CLIENT_ANALYTICS_EVENT_NAMES);

/**
 * Événements client (page.view, auth, abandon, satisfaction).
 * Les événements serveur (analyse, billing, compte) sont émis côté API.
 */
export async function POST(request: Request) {
  try {
    const user = await getOptionalUser();
    const body = (await request.json()) as {
      name?: unknown;
      meta?: unknown;
    };

    if (typeof body.name !== "string" || !isAnalyticsEventName(body.name)) {
      throw new AppError("BAD_REQUEST", "Événement analytics invalide.");
    }

    if (!CLIENT_ALLOWED.has(body.name)) {
      throw new AppError(
        "FORBIDDEN",
        "Cet événement ne peut pas être émis depuis le client.",
        403,
      );
    }

    // auth.* et abandon/satisfaction nécessitent une session (sauf signup
    // avant confirmation email — on accepte sans userId).
    if (
      (body.name === "analysis.abandon" ||
        body.name === "satisfaction.rated") &&
      !user
    ) {
      throw new AppError("UNAUTHORIZED", "Authentification requise.", 401);
    }

    const metaRaw =
      body.meta && typeof body.meta === "object" && !Array.isArray(body.meta)
        ? (body.meta as Record<string, string | number | boolean | null>)
        : {};

    const meta: Record<string, string | number | boolean | null> = {
      ...metaRaw,
    };

    if (typeof meta.pathname === "string") {
      meta.pathname = sanitizeAnalyticsPathname(meta.pathname);
    }
    delete meta.email;
    delete meta.text;
    delete meta.password;
    delete meta.fullName;

    if (body.name === "satisfaction.rated") {
      const rating = meta.rating;
      if (typeof rating !== "number" || rating < 1 || rating > 5) {
        throw new AppError(
          "BAD_REQUEST",
          "rating doit être un entier entre 1 et 5.",
        );
      }
    }

    if (body.name === "page.view" && typeof meta.pathname !== "string") {
      throw new AppError("BAD_REQUEST", "pathname requis pour page.view.");
    }

    await trackAnalyticsEvent({
      name: body.name,
      userId: user?.id ?? null,
      meta,
    });

    return apiSuccess({ ok: true });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
