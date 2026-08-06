import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { createBillingPortalSession } from "@/services/billing";

export const runtime = "nodejs";

/**
 * POST /api/billing/portal — portail client Stripe (factures / CB / annulation).
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const session = await createBillingPortalSession({
      userId: user.id,
      email: user.email,
    });
    return apiSuccess(session);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
