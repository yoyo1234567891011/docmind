import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { getBillingOverview } from "@/services/billing";
import { toClientBillingOverview } from "@/services/billing/public-overview";
import { syncUserSubscriptionFromStripe } from "@/services/billing/sync";
import { BILLING_PLANS } from "@/config/billing";

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

    return apiSuccess({
      ...toClientBillingOverview(overview),
      plans: Object.values(BILLING_PLANS),
      synced: result.synced,
      syncSource: result.source,
    });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
