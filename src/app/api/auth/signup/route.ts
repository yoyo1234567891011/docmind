import { docmindConfig } from "@/config/docmind";
import { SIGNUP_FULL_MESSAGE } from "@/config/signup-limits";
import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { getAuthEmailRedirectTo } from "@/lib/auth/email-redirect";
import { AppError } from "@/lib/errors";
import { checkRateLimitAsync, pruneRateLimitBuckets } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { registerSignupUnderCap } from "@/services/auth/signup-limit";

export const runtime = "nodejs";

/**
 * POST /api/auth/signup — inscription serveur avec plafond optionnel.
 */
export async function POST(request: Request) {
  try {
    pruneRateLimitBuckets();
    const limited = await checkRateLimitAsync({
      key: `signup:${getClientIp(request)}`,
      limit: 8,
      windowMs: 60 * 60 * 1000,
    });
    if (!limited.ok) {
      throw new AppError(
        "BAD_REQUEST",
        `Trop de tentatives d’inscription. Réessayez dans ${limited.retryAfterSec}s.`,
        429,
      );
    }

    const body = (await request.json()) as {
      email?: unknown;
      password?: unknown;
      fullName?: unknown;
      acceptedTerms?: unknown;
    };

    if (body.acceptedTerms !== true) {
      throw new AppError(
        "BAD_REQUEST",
        "Acceptez les CGU et la politique de confidentialité pour continuer.",
      );
    }

    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const fullName =
      typeof body.fullName === "string" ? body.fullName.trim() : "";

    if (!email || !email.includes("@")) {
      throw new AppError("BAD_REQUEST", "Email invalide.");
    }
    if (password.length < 8) {
      throw new AppError(
        "BAD_REQUEST",
        "Le mot de passe doit contenir au moins 8 caractères.",
      );
    }

    const result = await registerSignupUnderCap({
      email,
      password,
      fullName: fullName || undefined,
      emailRedirectTo: getAuthEmailRedirectTo(
        docmindConfig.auth.callbackPath,
      ),
    });

    return apiSuccess({
      ok: true as const,
      userId: result.userId,
      message: null as string | null,
    });
  } catch (error) {
    if (
      error instanceof AppError &&
      error.message === SIGNUP_FULL_MESSAGE
    ) {
      return apiFromUnknownError(error);
    }
    return apiFromUnknownError(error);
  }
}
