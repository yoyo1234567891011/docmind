import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireAdmin } from "@/lib/auth";
import { buildAdminPlatformOverview } from "@/services/admin/platform-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/overview — stats plateforme (users, tokens, jobs, LLM). */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const overview = await buildAdminPlatformOverview();
    return apiSuccess(overview);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
