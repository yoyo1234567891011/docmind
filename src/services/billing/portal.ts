import { getAppBaseUrl } from "@/config/billing";
import { getStripe, requireStripeConfigured } from "@/lib/stripe";
import { getOrCreateStripeCustomer } from "@/services/billing/customers";
import { AppError } from "@/lib/errors";

/**
 * Portail client Stripe — factures, moyen de paiement, annulation fin de période.
 */
export async function createBillingPortalSession(input: {
  userId: string;
  email: string | null;
}): Promise<{ url: string }> {
  requireStripeConfigured();

  const customerId = await getOrCreateStripeCustomer({
    userId: input.userId,
    email: input.email,
  });

  const stripe = getStripe();
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${getAppBaseUrl()}/facturation`,
    });

    if (!session.url) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Impossible d’ouvrir le portail de facturation.",
        502,
      );
    }

    return { url: session.url };
  } catch (error) {
    if (error instanceof AppError) throw error;

    const message =
      error instanceof Error ? error.message : "Erreur portail Stripe";
    const looksUnconfigured =
      /no configuration|customer portal|billing portal|portal configuration/i.test(
        message,
      );

    if (looksUnconfigured) {
      throw new AppError(
        "BAD_REQUEST",
        "Portail client Stripe non configuré. Admin : Dashboard Stripe → Settings → Billing → Customer portal — activer le portail, cocher « Cancel subscriptions » (at period end), puis enregistrer. Sans cela le bouton Annuler ne peut pas fonctionner.",
        503,
      );
    }

    throw new AppError(
      "INTERNAL_ERROR",
      `Portail facturation indisponible : ${message.slice(0, 180)}`,
      502,
    );
  }
}
