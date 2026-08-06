import { apiFromUnknownError } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { checkRateLimitAsync } from "@/lib/rate-limit";
import { buildUserDataExportZip } from "@/services/account/export-account";
import { trackAnalyticsEvent } from "@/services/analytics";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/account/export
 * Export ZIP RGPD Art. 20 (PDF, analyses, alertes, historique, paramètres).
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    if (user.isEval) {
      throw new AppError(
        "FORBIDDEN",
        "Export indisponible pour la session d’évaluation.",
        403,
      );
    }

    const limited = await checkRateLimitAsync({
      key: `export:${user.id}`,
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });
    if (!limited.ok) {
      throw new AppError(
        "BAD_REQUEST",
        `Trop d’exports. Réessayez dans ${limited.retryAfterSec}s.`,
        429,
      );
    }

    const { buffer, fileName, entryCount } =
      await buildUserDataExportZip(user.id);

    await trackAnalyticsEvent({
      name: "account.exported",
      userId: user.id,
      meta: {
        source: "account_export_api",
        entryCount,
        // Taille archive — pas le contenu
        bytes: buffer.byteLength,
      },
    });

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
        "Content-Length": String(buffer.byteLength),
      },
    });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
