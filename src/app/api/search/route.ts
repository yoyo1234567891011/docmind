import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { consumeQuota } from "@/services/quotas/enforce";
import { runSmartSearch } from "@/services/search";

export const runtime = "nodejs";

/**
 * POST /api/search
 * Body: { query: string, folderId?: string, limit?: number }
 *
 * Natural-language search over history (intent parse + structured match).
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json()) as {
      query?: string;
      folderId?: string;
      limit?: number;
    };

    const query = body?.query?.trim() ?? "";
    if (!query) {
      throw new AppError("BAD_REQUEST", "Le champ query est requis.");
    }
    if (query.length > 500) {
      throw new AppError(
        "BAD_REQUEST",
        "La requête est trop longue (500 caractères max).",
      );
    }

    await consumeQuota(user.id, "search");
    const result = await runSmartSearch({
      userId: user.id,
      query,
      folderId: body.folderId,
      limit: body.limit,
    });

    return apiSuccess(result);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
