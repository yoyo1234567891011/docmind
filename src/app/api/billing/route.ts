import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { BILLING_PLANS } from "@/config/billing";
import { getBillingOverview } from "@/services/billing";
import { toClientBillingOverview } from "@/services/billing/public-overview";

export const runtime = "nodejs";

/**
 * GET /api/billing — état abonnement + factures + catalogue plans.
 * Les IDs Stripe bruts ne sont pas exposés au navigateur.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const overview = await getBillingOverview(user.id);
    return apiSuccess({
      ...toClientBillingOverview(overview),
      plans: Object.values(BILLING_PLANS),
    });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
