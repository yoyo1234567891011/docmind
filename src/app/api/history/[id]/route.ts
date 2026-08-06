import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { assertAssignableFolderId } from "@/services/folders";
import {
  deleteHistoryRecord,
  getHistoryRecord,
  patchHistoryDocument,
} from "@/services/history";
import { assertTagIds } from "@/services/tags";
import type { PatchHistoryInput } from "@/types";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/history/:id
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;

    if (!id?.trim()) {
      throw new AppError("BAD_REQUEST", "Identifiant d'historique requis.");
    }

    const record = await getHistoryRecord(user.id, id.trim());
    return apiSuccess(record);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}

/**
 * PATCH /api/history/:id
 * Body: { folderId?, displayName?, fileName?, favorite?, tagIds? }
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;

    if (!id?.trim()) {
      throw new AppError("BAD_REQUEST", "Identifiant d'historique requis.");
    }

    const body = (await request.json()) as PatchHistoryInput;
    const patch: PatchHistoryInput = {};

    if ("folderId" in body) {
      patch.folderId = await assertAssignableFolderId(
        user.id,
        body.folderId === undefined ? null : body.folderId,
      );
    }
    if ("displayName" in body) {
      patch.displayName =
        body.displayName === null || body.displayName === undefined
          ? null
          : String(body.displayName);
    }
    if (typeof body.fileName === "string") {
      patch.fileName = body.fileName;
    }
    if (typeof body.favorite === "boolean") {
      patch.favorite = body.favorite;
    }
    if (Array.isArray(body.tagIds)) {
      patch.tagIds = await assertTagIds(
        user.id,
        body.tagIds.filter((value): value is string => typeof value === "string"),
      );
    }

    const record = await patchHistoryDocument(user.id, id.trim(), patch);
    return apiSuccess(record);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}

/**
 * DELETE /api/history/:id
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;

    if (!id?.trim()) {
      throw new AppError("BAD_REQUEST", "Identifiant d'historique requis.");
    }

    await deleteHistoryRecord(user.id, id.trim());
    return apiSuccess({ deleted: true });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
