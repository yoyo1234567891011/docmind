import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireAdmin } from "@/lib/auth";
import { buildProductionDashboard } from "@/services/ops/production-dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/production — dashboard ops + business. */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const dashboard = await buildProductionDashboard();
    return apiSuccess(dashboard);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
