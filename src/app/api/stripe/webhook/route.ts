import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  constructStripeEvent,
  handleStripeWebhookEvent,
} from "@/services/billing";

export const runtime = "nodejs";

/**
 * POST /api/stripe/webhook
 * Endpoint public signé Stripe — ne pas protéger par session utilisateur.
 */
export async function POST(request: Request) {
  try {
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      throw new AppError("BAD_REQUEST", "Signature Stripe manquante.", 400);
    }

    const rawBody = await request.text();
    const event = constructStripeEvent(rawBody, signature);
    const result = await handleStripeWebhookEvent(event);

    return apiSuccess({
      received: true,
      type: event.type,
      handled: result.handled,
    });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
