import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { BILLING_PLANS, withLiveQuotaFeatures } from "@/config/billing";
import { isStripeConfigured, isStripeLiveMode } from "@/lib/stripe";
import { getBillingOverview } from "@/services/billing";
import { toClientBillingOverview } from "@/services/billing/public-overview";
import { syncUserSubscriptionFromStripe } from "@/services/billing/sync";

export const runtime = "nodejs";

/**
 * POST /api/billing/sync
 * Resynchronise l’abonnement depuis Stripe (session Checkout ou customer).
 * Body optionnel: { sessionId?: string }
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    let sessionId: string | null = null;
    try {
      const body = (await request.json()) as { sessionId?: string };
      sessionId = body.sessionId?.trim() || null;
    } catch {
      sessionId = null;
    }

    const result = await syncUserSubscriptionFromStripe(user.id, {
      checkoutSessionId: sessionId,
    });
    const overview = await getBillingOverview(user.id);
    const stripeConfigured = isStripeConfigured();

    return apiSuccess({
      ...toClientBillingOverview({
        ...overview,
        plan: withLiveQuotaFeatures(overview.plan),
      }),
      plans: Object.values(BILLING_PLANS).map(withLiveQuotaFeatures),
      stripeTestMode: stripeConfigured && !isStripeLiveMode(),
      synced: result.synced,
      syncSource: result.source,
    });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
