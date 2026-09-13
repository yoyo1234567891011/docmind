import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { BILLING_PLANS, withLiveQuotaFeatures } from "@/config/billing";
import { isStripeConfigured, isStripeLiveMode } from "@/lib/stripe";
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
    const overview = await getBillingOverview(user.id, { reconcile: "force" });
    const stripeConfigured = isStripeConfigured();
    return apiSuccess({
      ...toClientBillingOverview({
        ...overview,
        plan: withLiveQuotaFeatures(overview.plan),
      }),
      plans: Object.values(BILLING_PLANS).map(withLiveQuotaFeatures),
      stripeTestMode: stripeConfigured && !isStripeLiveMode(),
    });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
