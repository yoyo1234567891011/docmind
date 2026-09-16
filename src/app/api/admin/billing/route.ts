import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireAdmin } from "@/lib/auth";
import { collectAdminBillingDetail } from "@/services/admin/billing-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/billing — répartition plans + past_due + mode Test/Live. */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const data = await collectAdminBillingDetail();
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
