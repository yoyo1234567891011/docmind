import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireAdmin } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import {
  adminResetAnalyzeQuota,
  adminSyncUserStripe,
  getAdminUserDetail,
} from "@/services/admin/users-admin";
import { appendAdminActionLog } from "@/services/admin/ops-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ userId: string }> };

/** GET /api/admin/users/[userId] */
export async function GET(request: Request, context: RouteContext) {
  try {
    await requireAdmin(request);
    const { userId } = await context.params;
    const detail = await getAdminUserDetail(userId);
    if (!detail) throw new AppError("NOT_FOUND", "Utilisateur introuvable", 404);
    return apiSuccess({ detail });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}

/**
 * POST /api/admin/users/[userId]
 * body: { action: "sync_stripe" } | { action: "reset_analyze_quota", confirm: string }
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const admin = await requireAdmin(request);
    const { userId } = await context.params;
    const body = (await request.json()) as {
      action?: unknown;
      confirm?: unknown;
    };

    if (body.action === "sync_stripe") {
      const detail = await adminSyncUserStripe({
        userId,
        adminUserId: admin.id,
        adminEmail: admin.email,
      });
      return apiSuccess({ detail });
    }

    if (body.action === "reset_analyze_quota") {
      if (typeof body.confirm !== "string" || !body.confirm.trim()) {
        throw new AppError(
          "BAD_REQUEST",
          "confirm requis (email ou userId exact).",
        );
      }
      try {
        const detail = await adminResetAnalyzeQuota({
          userId,
          confirm: body.confirm,
          adminUserId: admin.id,
        });
        return apiSuccess({ detail });
      } catch (err) {
        await appendAdminActionLog({
          action: "reset_analyze_quota",
          adminUserId: admin.id,
          targetUserId: userId,
          ok: false,
          detail: err instanceof Error ? err.message : "error",
        });
        throw err instanceof AppError
          ? err
          : new AppError(
              "BAD_REQUEST",
              err instanceof Error ? err.message : "Reset impossible",
            );
      }
    }

    throw new AppError(
      "BAD_REQUEST",
      "action doit être sync_stripe ou reset_analyze_quota",
    );
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
