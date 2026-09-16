import { AppError } from "@/lib/errors";
import type Stripe from "stripe";

/**
 * Erreurs Stripe liées au paiement immédiat (changement de plan).
 * Avec `pending_if_incomplete`, un échec laisse l’ancien price ; le plan local
 * n’est appliqué qu’après paiement confirmé (voir `changeSubscriptionPlan`).
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
      "Authentification bancaire (3DS) requise. Votre plan actuel n’a pas été modifié — finalisez le paiement sur la page Stripe, puis revenez à Facturation.",
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

  // Ne jamais renvoyer le message brut Stripe / stack au client.
  return new AppError(
    "INTERNAL_ERROR",
    "Changement de plan impossible pour le moment.",
    502,
  );
}
