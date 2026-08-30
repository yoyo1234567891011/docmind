import { AppError } from "@/lib/errors";
import type Stripe from "stripe";

/**
 * Erreurs Stripe liées au paiement immédiat (changement de plan).
 * Le plan Stripe n’est pas modifié si le prélèvement échoue (`error_if_incomplete`).
 */
export function toStripeBillingAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const stripeErr = error as Stripe.errors.StripeError & {
    decline_code?: string;
  };

  const type = stripeErr?.type ?? "";
  const code = stripeErr?.code ?? "";
  const message = (stripeErr?.message ?? "").toLowerCase();

  if (
    type === "StripeCardError" ||
    type === "card_error" ||
    code === "card_declined" ||
    code === "insufficient_funds" ||
    code === "expired_card"
  ) {
    const detail = stripeErr.decline_code
      ? ` (${stripeErr.decline_code})`
      : "";
    return new AppError(
      "BAD_REQUEST",
      `Le paiement du prorata a échoué${detail}. Votre plan actuel n’a pas été modifié — mettez à jour votre carte via le portail Stripe.`,
      402,
    );
  }

  if (
    code === "invoice_payment_intent_requires_action" ||
    message.includes("requires_action") ||
    message.includes("authentication")
  ) {
    return new AppError(
      "BAD_REQUEST",
      "Authentification bancaire requise. Votre plan actuel n’a pas été modifié — finalisez le paiement via le portail Stripe.",
      402,
    );
  }

  if (
    message.includes("payment") &&
    (message.includes("failed") ||
      message.includes("incomplete") ||
      message.includes("could not be"))
  ) {
    return new AppError(
      "BAD_REQUEST",
      "Le paiement du prorata a échoué. Votre plan actuel n’a pas été modifié.",
      402,
    );
  }

  if (error instanceof Error && error.message) {
    return new AppError("INTERNAL_ERROR", error.message, 502);
  }

  return new AppError(
    "INTERNAL_ERROR",
    "Changement de plan impossible pour le moment.",
    502,
  );
}
