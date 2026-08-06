import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { assertValidPdfUpload } from "@/lib/document-validation";
import { AppError } from "@/lib/errors";
import { checkRateLimitAsync, pruneRateLimitBuckets } from "@/lib/rate-limit";
import { uploadPdfDocument } from "@/services/documents";
import { consumeQuota } from "@/services/quotas/enforce";

export const runtime = "nodejs";

/**
 * POST /api/upload
 * Accepts multipart/form-data with field "file" (PDF),
 * stores the file, extracts text, and returns both.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    pruneRateLimitBuckets();
    const limited = await checkRateLimitAsync({
      key: `upload:${user.id}`,
      limit: 40,
      windowMs: 60 * 60 * 1000,
    });
    if (!limited.ok) {
      throw new AppError(
        "BAD_REQUEST",
        `Trop d’uploads. Réessayez dans ${limited.retryAfterSec}s.`,
        429,
      );
    }
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new AppError(
        "BAD_REQUEST",
        'Le champ "file" est requis et doit contenir un PDF.',
      );
    }

    await assertValidPdfUpload(file);
    await consumeQuota(user.id, "upload");
    const result = await uploadPdfDocument(user.id, file);

    return apiSuccess(result, 201);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
