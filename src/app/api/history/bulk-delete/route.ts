import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { deleteHistoryRecordsBulk } from "@/services/history";

export const runtime = "nodejs";

/**
 * POST /api/history/bulk-delete
 * Body: { ids: string[] } — max 50 history ids du user connecté.
 * Cascade = même que DELETE /api/history/:id (jobs P2 inclus).
 * Succès partiel possible (id inconnu / pas à soi → failed[], HTTP 200).
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json().catch(() => null)) as {
      ids?: unknown;
    } | null;

    if (!body || !Array.isArray(body.ids)) {
      throw new AppError(
        "BAD_REQUEST",
        "Corps invalide : { ids: string[] } requis.",
      );
    }

    const result = await deleteHistoryRecordsBulk(user.id, body.ids);
    return apiSuccess(result);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
