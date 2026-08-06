import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import {
  buildDocumentTimeline,
  buildEntityTimeline,
  listCounterpartyAggregates,
} from "@/services/memory/timeline";

export const runtime = "nodejs";

/**
 * GET /api/memory/timeline?entityId= | documentId=
 * GET /api/memory/timeline?view=counterparties
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view");
    const entityId = searchParams.get("entityId");
    const documentId = searchParams.get("documentId");
    const limitRaw = Number(searchParams.get("limit") || "60");
    const limit = Number.isFinite(limitRaw)
      ? Math.min(120, Math.max(5, limitRaw))
      : 60;

    if (view === "counterparties") {
      const counterparties = await listCounterpartyAggregates(user.id, {
        limit: Math.min(40, limit),
      });
      return apiSuccess({ counterparties });
    }

    if (entityId) {
      const events = await buildEntityTimeline(user.id, entityId, { limit });
      return apiSuccess({ entityId, events });
    }

    if (documentId) {
      const payload = await buildDocumentTimeline(user.id, documentId, {
        limit,
      });
      return apiSuccess(payload);
    }

    throw new AppError(
      "BAD_REQUEST",
      "Paramètre requis : entityId, documentId ou view=counterparties.",
      400,
    );
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
