import { withKeyedLock } from "@/lib/keyed-lock";
import { getStripe } from "@/lib/stripe";
import {
  getUserSubscription,
  upsertSubscriptionPatch,
} from "@/services/billing/store";

/**
 * Crée ou récupère le customer Stripe lié au user DocMind.
 * Sous mutex : évite deux customers Stripe pour le même user.
 */
export async function getOrCreateStripeCustomer(input: {
  userId: string;
  email: string | null;
}): Promise<string> {
  return withKeyedLock(`billing:customer:${input.userId}`, async () => {
    const current = await getUserSubscription(input.userId);
    if (current.stripeCustomerId) {
      return current.stripeCustomerId;
    }

    const stripe = getStripe();
    const customer = await stripe.customers.create(
      {
        email: input.email || undefined,
        metadata: {
          docmind_user_id: input.userId,
        },
      },
      { idempotencyKey: `customer:${input.userId}` },
    );

    await upsertSubscriptionPatch(input.userId, {
      stripeCustomerId: customer.id,
    });

    return customer.id;
  });
}
