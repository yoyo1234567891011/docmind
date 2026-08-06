import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { getOptionalUser, requireAdmin } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { checkRateLimitAsync, pruneRateLimitBuckets } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { isBetaFeedbackEnabled } from "@/config/runtime";
import {
  createErrorReport,
  isErrorReportKind,
  listErrorReports,
} from "@/services/beta";
import type { ErrorReportSeverity } from "@/types/beta";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? "100");
    const entries = await listErrorReports(limit);
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
        "Les signalements sont temporairement désactivés.",
        503,
      );
    }

    pruneRateLimitBuckets();
    const user = await getOptionalUser();
    const limited = await checkRateLimitAsync({
      key: `reports:${user?.id ?? getClientIp(request)}`,
      limit: 20,
      windowMs: 60 * 60 * 1000,
    });
    if (!limited.ok) {
      throw new AppError(
        "BAD_REQUEST",
        `Trop de signalements. Réessayez dans ${limited.retryAfterSec}s.`,
        429,
      );
    }
    const body = (await request.json()) as {
      kind?: unknown;
      severity?: unknown;
      message?: unknown;
      page?: unknown;
      errorCode?: unknown;
      errorDetail?: unknown;
    };

    if (typeof body.kind !== "string" || !isErrorReportKind(body.kind)) {
      throw new AppError("BAD_REQUEST", "Type de signalement invalide.");
    }
    if (typeof body.message !== "string" || body.message.trim().length < 5) {
      throw new AppError(
        "BAD_REQUEST",
        "Merci de décrire le problème (5 caractères minimum).",
      );
    }

    const severityRaw =
      typeof body.severity === "string" ? body.severity : "medium";
    const severity = (
      ["low", "medium", "high"].includes(severityRaw) ? severityRaw : "medium"
    ) as ErrorReportSeverity;

    const entry = await createErrorReport({
      userId: user?.id ?? null,
      email: user?.email ?? null,
      kind: body.kind,
      severity,
      message: body.message,
      page: typeof body.page === "string" ? body.page : null,
      errorCode: typeof body.errorCode === "string" ? body.errorCode : null,
      errorDetail:
        typeof body.errorDetail === "string" ? body.errorDetail : null,
      userAgent: request.headers.get("user-agent"),
    });

    return apiSuccess({ id: entry.id }, 201);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
