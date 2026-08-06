import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { BILLING_PLANS } from "@/config/billing";
import { getBillingOverview } from "@/services/billing";

export const runtime = "nodejs";

/**
 * GET /api/billing — état abonnement + factures + catalogue plans.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const overview = await getBillingOverview(user.id);
    return apiSuccess({
      ...overview,
      plans: Object.values(BILLING_PLANS),
    });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
