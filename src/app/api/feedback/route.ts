import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { getOptionalUser, requireAdmin } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { checkRateLimitAsync, pruneRateLimitBuckets } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { isBetaFeedbackEnabled } from "@/config/runtime";
import {
  createFeedback,
  isFeedbackCategory,
  listFeedback,
} from "@/services/beta";
import type { FeedbackRating } from "@/types/beta";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? "100");
    const entries = await listFeedback(limit);
    return apiSuccess({ total: entries.length, entries });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!isBetaFeedbackEnabled()) {
      throw new AppError(
        "SERVICE_UNAVAILABLE",
        "Le feedback est temporairement désactivé.",
        503,
      );
    }

    pruneRateLimitBuckets();
    const user = await getOptionalUser();
    const limited = await checkRateLimitAsync({
      key: `feedback:${user?.id ?? getClientIp(request)}`,
      limit: 10,
      windowMs: 60 * 60 * 1000,
    });
    if (!limited.ok) {
      throw new AppError(
        "BAD_REQUEST",
        `Trop de feedbacks. Réessayez dans ${limited.retryAfterSec}s.`,
        429,
      );
    }
    const body = (await request.json()) as {
      category?: unknown;
      rating?: unknown;
      message?: unknown;
      page?: unknown;
    };

    if (typeof body.category !== "string" || !isFeedbackCategory(body.category)) {
      throw new AppError("BAD_REQUEST", "Catégorie de feedback invalide.");
    }
    if (typeof body.message !== "string" || body.message.trim().length < 5) {
      throw new AppError(
        "BAD_REQUEST",
        "Merci d'écrire un message d'au moins 5 caractères.",
      );
    }

    let rating: FeedbackRating | null = null;
    if (typeof body.rating === "number" && body.rating >= 1 && body.rating <= 5) {
      rating = Math.round(body.rating) as FeedbackRating;
    }

    const entry = await createFeedback({
      userId: user?.id ?? null,
      email: user?.email ?? null,
      category: body.category,
      rating,
      message: body.message,
      page: typeof body.page === "string" ? body.page : null,
      userAgent: request.headers.get("user-agent"),
    });

    return apiSuccess({ id: entry.id }, 201);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
