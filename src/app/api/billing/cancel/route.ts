import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import {
  cancelPremiumSubscription,
  resumePremiumSubscription,
} from "@/services/billing";

export const runtime = "nodejs";

/**
 * POST /api/billing/cancel
 * Body: { immediately?: boolean, resume?: boolean }
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      immediately?: boolean;
      resume?: boolean;
    };

    if (body.resume) {
      await resumePremiumSubscription(user.id);
      return apiSuccess({ resumed: true });
    }

    const result = await cancelPremiumSubscription({
      userId: user.id,
      immediately: Boolean(body.immediately),
    });
    return apiSuccess(result);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
