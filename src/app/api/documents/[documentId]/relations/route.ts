import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { assertSafeResourceId } from "@/config/paths";
import {
  applyRelationAction,
  getRelationsForUi,
  type RelationUiAction,
} from "@/services/memory/relations-ui";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ documentId: string }>;
}

/**
 * GET /api/documents/:documentId/relations
 * Liste UI progressive enhancement (pending / ready / empty).
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireUser(request);
    const { documentId: raw } = await context.params;
    const documentId = assertSafeResourceId(raw, "documentId");
    const payload = await getRelationsForUi(user.id, documentId);
    return apiSuccess(payload);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}

/**
 * PATCH /api/documents/:documentId/relations
 * Body: { relationId, action: confirm | dismiss | snooze }
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireUser(request);
    const { documentId: raw } = await context.params;
    const documentId = assertSafeResourceId(raw, "documentId");

    const body = (await request.json()) as {
      relationId?: string;
      action?: string;
    };
    const relationId = body.relationId?.trim();
    const action = body.action?.trim() as RelationUiAction | undefined;

    if (!relationId) {
      throw new AppError("BAD_REQUEST", "relationId requis.", 400);
    }
    if (
      action !== "confirm" &&
      action !== "dismiss" &&
      action !== "snooze"
    ) {
      throw new AppError(
        "BAD_REQUEST",
        "action invalide (confirm | dismiss | snooze).",
        400,
      );
    }

    const item = await applyRelationAction(
      user.id,
      documentId,
      relationId,
      action,
    );
    return apiSuccess({ relation: item });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
