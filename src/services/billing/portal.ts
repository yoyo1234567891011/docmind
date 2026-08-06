import { getAppBaseUrl } from "@/config/billing";
import { getStripe, requireStripeConfigured } from "@/lib/stripe";
import { getOrCreateStripeCustomer } from "@/services/billing/customers";
import { AppError } from "@/lib/errors";

/**
 * Portail client Stripe — factures, moyen de paiement, annulation.
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
}
