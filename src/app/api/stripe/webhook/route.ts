import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  constructStripeEvent,
  handleStripeWebhookEvent,
  stripeWebhookLogContext,
} from "@/services/billing";

export const runtime = "nodejs";
export const maxDuration = 60;

function logWebhook(
  step: "received" | "success" | "error",
  ctx: ReturnType<typeof stripeWebhookLogContext> | null,
  extra?: { handled?: boolean; message?: string },
) {
  console.info("[stripe-webhook]", {
    step,
    ...(ctx ?? {}),
    ...extra,
  });
}

/**
 * POST /api/stripe/webhook
 * Endpoint public signé Stripe — ne pas protéger par session utilisateur.
 */
export async function POST(request: Request) {
  let ctx: ReturnType<typeof stripeWebhookLogContext> | null = null;
  try {
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      throw new AppError("BAD_REQUEST", "Signature Stripe manquante.", 400);
    }

    const rawBody = await request.text();
    const event = constructStripeEvent(rawBody, signature);
    ctx = stripeWebhookLogContext(event);
    logWebhook("received", ctx);

    const result = await handleStripeWebhookEvent(event);
    logWebhook("success", ctx, { handled: result.handled });

    return apiSuccess({
      received: true,
      type: event.type,
      handled: result.handled,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 200) : "Unknown error";
    logWebhook("error", ctx, { message });
    return apiFromUnknownError(error);
  }
}
