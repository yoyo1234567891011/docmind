import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { getQuotaStatus } from "@/services/quotas/enforce";

export const runtime = "nodejs";

/** GET /api/quotas — état des quotas mensuels Free/Premium. */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const status = await getQuotaStatus(user.id);
    return apiSuccess(status);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
