import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { createPremiumCheckoutSession } from "@/services/billing";

export const runtime = "nodejs";

/**
 * POST /api/billing/checkout — session Stripe Checkout Premium.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const session = await createPremiumCheckoutSession({
      userId: user.id,
      email: user.email,
    });
    return apiSuccess(session);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
