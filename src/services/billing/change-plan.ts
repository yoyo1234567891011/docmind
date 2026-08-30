import {
  areStripePaidPricesConfigured,
  getStripePriceIdForPlan,
  isPaidBillingPlanId,
  planIdFromStripePriceId,
} from "@/config/billing";
import { AppError } from "@/lib/errors";
import { withKeyedLock } from "@/lib/keyed-lock";
import { getStripe, requireStripeConfigured } from "@/lib/stripe";
import {
  applyStripeSubscription,
  planFromSubscription,
  readSubscriptionPriceId,
} from "@/services/billing/apply-subscription";
import { resolveEffectivePlan } from "@/services/billing/access";
import { getUserSubscription } from "@/services/billing/store";
import { syncUserSubscriptionFromStripe } from "@/services/billing/sync";
import { toStripeBillingAppError } from "@/services/billing/stripe-payment-errors";
import type {
  BillingImmediateInvoice,
  PaidBillingPlanId,
} from "@/types/billing";
import type Stripe from "stripe";

const SUBSCRIPTION_EXPAND = ["items.data.price"] as const;

export function resolveBillableSubscriptionItem(
  stripeSub: Stripe.Subscription,
  hintPriceId?: string | null,
): Stripe.SubscriptionItem {
  const items = stripeSub.items?.data ?? [];
  if (items.length === 0) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Abonnement Stripe sans ligne de prix.",
      502,
    );
  }

  if (hintPriceId) {
    const match = items.find((entry) => {
      const priceId =
        typeof entry.price === "string" ? entry.price : entry.price?.id;
      return priceId === hintPriceId;
    });
    if (match) return match;
  }

  const first = items[0];
  if (!first?.id) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Abonnement Stripe sans ligne de prix.",
      502,
    );
  }
  return first;
}

async function retrieveSubscriptionHydrated(
  stripe: ReturnType<typeof getStripe>,
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.retrieve(subscriptionId, {
    expand: [...SUBSCRIPTION_EXPAND],
  });
}

function assertStripePlanMatches(
  sub: Stripe.Subscription,
  targetPlan: PaidBillingPlanId,
): void {
  const priceId = readSubscriptionPriceId(sub);
  const fromPrice = planIdFromStripePriceId(priceId);
  if (fromPrice === targetPlan) return;

  if (!areStripePaidPricesConfigured()) {
    const fromCatalog = planFromSubscription(sub);
    if (fromCatalog === targetPlan) return;
  }

  throw new AppError(
    "INTERNAL_ERROR",
    `Stripe n'a pas confirmé le plan ${targetPlan} (price actuel : ${priceId ?? "inconnu"}). Réessayez ou contactez le support.`,
    502,
  );
}

function toImmediateInvoice(
  invoice: Stripe.Invoice,
): BillingImmediateInvoice {
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    amountDue: (invoice.amount_due ?? 0) / 100,
    amountPaid: (invoice.amount_paid ?? 0) / 100,
    currency: (invoice.currency || "eur").toUpperCase(),
    createdAt: new Date((invoice.created ?? 0) * 1000).toISOString(),
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
  };
}

/**
 * Change le price Stripe d’un abonnement existant (upgrade / downgrade).
 * Facture le prorata immédiatement (`always_invoice`).
 * Si le paiement échoue, Stripe annule la mise à jour — le plan local n’est pas modifié.
 */
export async function changeSubscriptionPlan(
  input: {
    userId: string;
    plan: PaidBillingPlanId;
  },
  options?: { skipLock?: boolean },
): Promise<{
  plan: PaidBillingPlanId;
  immediateInvoice: BillingImmediateInvoice | null;
}> {
  requireStripeConfigured();

  const targetPlan = input.plan;
  if (!isPaidBillingPlanId(targetPlan)) {
    throw new AppError("BAD_REQUEST", "Plan Stripe invalide.", 400);
  }

  const priceId = getStripePriceIdForPlan(targetPlan);
  if (!priceId) {
    throw new AppError(
      "BAD_REQUEST",
      `Price Stripe manquant pour le plan ${targetPlan}.`,
      503,
    );
  }

  const execute = async (): Promise<{
    plan: PaidBillingPlanId;
    immediateInvoice: BillingImmediateInvoice | null;
  }> => {
    const sub = await getUserSubscription(input.userId);
    if (!sub.stripeSubscriptionId) {
      throw new AppError(
        "BAD_REQUEST",
        "Aucun abonnement actif à modifier. Utilisez le checkout.",
        400,
      );
    }

    const currentPlan = resolveEffectivePlan(sub.plan, sub.status, {
      currentPeriodEnd: sub.currentPeriodEnd,
    });
    if (currentPlan === targetPlan) {
      throw new AppError("BAD_REQUEST", "Vous êtes déjà sur ce plan.", 400);
    }

    const stripe = getStripe();
    const stripeSub = await retrieveSubscriptionHydrated(
      stripe,
      sub.stripeSubscriptionId,
    );
    const item = resolveBillableSubscriptionItem(
      stripeSub,
      sub.stripePriceId,
    );

    let verified: Stripe.Subscription;
    let immediateInvoice: BillingImmediateInvoice | null = null;

    try {
      await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        items: [{ id: item.id, price: priceId }],
        proration_behavior: "always_invoice",
        payment_behavior: "error_if_incomplete",
        cancel_at_period_end: false,
        metadata: {
          ...stripeSub.metadata,
          docmind_user_id: input.userId,
          docmind_plan: targetPlan,
          plan: targetPlan,
        },
        expand: ["latest_invoice"],
      });

      verified = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId, {
        expand: [...SUBSCRIPTION_EXPAND, "latest_invoice"],
      });
      assertStripePlanMatches(verified, targetPlan);

      const latestRaw = verified.latest_invoice;
      const latestId =
        typeof latestRaw === "string" ? latestRaw : latestRaw?.id;
      if (latestId) {
        const invoice =
          typeof latestRaw === "object" && latestRaw && "amount_due" in latestRaw
            ? latestRaw
            : await stripe.invoices.retrieve(latestId);
        immediateInvoice = toImmediateInvoice(invoice);
      }
    } catch (error) {
      try {
        await syncUserSubscriptionFromStripe(input.userId);
      } catch {
        // garde l’état local si resync impossible
      }
      throw toStripeBillingAppError(error);
    }

    await applyStripeSubscription(input.userId, verified, {
      id: `plan_change_${verified.id}_${targetPlan}_${readSubscriptionPriceId(verified) ?? "na"}`,
      type: "customer.subscription.updated",
      created: Math.floor(Date.now() / 1000),
    });

    const appliedPlan = planFromSubscription(verified);
    if (!isPaidBillingPlanId(appliedPlan) || appliedPlan !== targetPlan) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Synchronisation locale incohérente après changement Stripe.",
        502,
      );
    }

    return { plan: appliedPlan, immediateInvoice };
  };

  if (options?.skipLock) {
    return execute();
  }

  return withKeyedLock(`billing:checkout:${input.userId}`, execute);
}
