import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireAdmin } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import {
  findUserIdByEmail,
  getAdminUserDetail,
  listAdminUsers,
} from "@/services/admin/users-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/users?limit=&email=&userId= */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId")?.trim();
    const email = url.searchParams.get("email")?.trim();
    const limit = Number(url.searchParams.get("limit") ?? "50");

    if (userId) {
      const detail = await getAdminUserDetail(userId);
      if (!detail) throw new AppError("NOT_FOUND", "Utilisateur introuvable", 404);
      return apiSuccess({ detail });
    }

    if (email) {
      const id = await findUserIdByEmail(email);
      if (!id) throw new AppError("NOT_FOUND", "Email introuvable", 404);
      const detail = await getAdminUserDetail(id);
      if (!detail) throw new AppError("NOT_FOUND", "Utilisateur introuvable", 404);
      return apiSuccess({ detail });
    }

    const list = await listAdminUsers(
      Number.isFinite(limit) ? limit : 50,
    );
    return apiSuccess(list);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
