import {
  areStripePaidPricesConfigured,
  getAppBaseUrl,
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
import {
  assertProrationInvoiceSettled,
  PLAN_CHANGE_PRORATION_UPDATE,
} from "@/services/billing/plan-change-full-price";
import { clearPendingDocmindAdjustmentItems } from "@/services/billing/renewal-catalog";
import type {
  BillingImmediateInvoice,
  PaidBillingPlanId,
} from "@/types/billing";
import type Stripe from "stripe";

const SUBSCRIPTION_EXPAND = ["items.data.price"] as const;
const PLAN_CHANGE_RETRIEVE_EXPAND = [
  ...SUBSCRIPTION_EXPAND,
  "latest_invoice.payments.data.payment.payment_intent",
] as const;

export type ChangeSubscriptionPlanResult =
  | {
      outcome: "applied";
      plan: PaidBillingPlanId;
      immediateInvoice: BillingImmediateInvoice | null;
    }
  | {
      outcome: "action_required";
      url: string;
      targetPlan: PaidBillingPlanId;
      immediateInvoice: BillingImmediateInvoice | null;
    };

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

function asInvoice(
  raw: string | Stripe.Invoice | null | undefined,
): Stripe.Invoice | null {
  if (!raw || typeof raw === "string") return null;
  return raw;
}

function asPaymentIntent(
  raw: string | Stripe.PaymentIntent | null | undefined,
): Stripe.PaymentIntent | null {
  if (!raw || typeof raw === "string") return null;
  return raw;
}

/** Stripe a retiré `invoice.payment_intent` des types ; runtime + `payments` restent. */
async function resolveInvoicePaymentIntent(
  stripe: ReturnType<typeof getStripe>,
  invoice: Stripe.Invoice | null,
): Promise<Stripe.PaymentIntent | null> {
  if (!invoice) return null;

  const legacy = (
    invoice as Stripe.Invoice & {
      payment_intent?: string | Stripe.PaymentIntent | null;
    }
  ).payment_intent;
  const fromLegacy = asPaymentIntent(legacy);
  if (fromLegacy) return fromLegacy;
  if (typeof legacy === "string" && legacy) {
    return stripe.paymentIntents.retrieve(legacy);
  }

  let payments = invoice.payments?.data;
  if (!payments?.length) {
    const hydrated = await stripe.invoices.retrieve(invoice.id, {
      expand: ["payments.data.payment.payment_intent"],
    });
    payments = hydrated.payments?.data;
  }

  for (const entry of payments ?? []) {
    const raw = entry.payment?.payment_intent;
    const expanded = asPaymentIntent(raw);
    if (expanded) return expanded;
    if (typeof raw === "string" && raw) {
      return stripe.paymentIntents.retrieve(raw);
    }
  }
  return null;
}

/**
 * Classifie l’état post-update (`pending_if_incomplete`).
 * - settled : price basculé + facture OK → apply local autorisé
 * - action_required : 3DS / SCA → redirect hosted invoice, plan local inchangé
 * - failed : refus / PM manquant → erreur claire, plan inchangé
 */
export function classifyPlanChangePayment(input: {
  subscription: Stripe.Subscription;
  invoice: Stripe.Invoice | null;
  paymentIntent: Stripe.PaymentIntent | null;
}): "settled" | "action_required" | "failed" {
  const { subscription, invoice, paymentIntent: pi } = input;
  const pending = Boolean(subscription.pending_update);
  const due = invoice?.amount_due ?? 0;
  const invStatus = invoice?.status ?? null;

  if (pi) {
    if (
      pi.status === "requires_action" ||
      pi.status === "requires_confirmation"
    ) {
      return "action_required";
    }
    if (
      pi.status === "requires_payment_method" ||
      pi.status === "canceled"
    ) {
      return "failed";
    }
  }

  if (pending) {
    if (invStatus === "open" && due > 0) {
      return "action_required";
    }
    return "failed";
  }

  if (!invoice) return "settled";
  if (invStatus === "paid" || due <= 0) return "settled";
  if (pi?.status === "succeeded") return "settled";
  if (invStatus === "open" && due > 0) return "action_required";
  if (invStatus === "uncollectible" || invStatus === "void") return "failed";

  return "failed";
}

async function resolvePlanChangeActionUrl(
  stripe: ReturnType<typeof getStripe>,
  invoice: Stripe.Invoice | null,
  customerId: string,
): Promise<string> {
  if (invoice?.hosted_invoice_url) {
    return invoice.hosted_invoice_url;
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${getAppBaseUrl()}/facturation?checkout=success`,
  });
  if (!session.url) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Impossible d’ouvrir la confirmation de paiement Stripe.",
      502,
    );
  }
  return session.url;
}

/**
 * Change le price Stripe d’un abonnement existant (upgrade / downgrade).
 * Prorata immédiat (`always_invoice`) + `pending_if_incomplete`.
 * Le plan local / quotas ne changent qu’après paiement confirmé (ou amount_due 0).
 * SCA / 3DS → `outcome: action_required` + URL facture hébergée (pas d’apply).
 */
export async function changeSubscriptionPlan(
  input: {
    userId: string;
    plan: PaidBillingPlanId;
  },
  options?: { skipLock?: boolean },
): Promise<ChangeSubscriptionPlanResult> {
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

  const execute = async (): Promise<ChangeSubscriptionPlanResult> => {
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

    if (!sub.stripeCustomerId) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Customer Stripe manquant pour le changement de plan.",
        502,
      );
    }

    let verified: Stripe.Subscription;
    let invoice: Stripe.Invoice | null = null;
    let paymentIntent: Stripe.PaymentIntent | null = null;

    try {
      await clearPendingDocmindAdjustmentItems(stripe, sub.stripeCustomerId);

      await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        items: [{ id: item.id, price: priceId }],
        ...PLAN_CHANGE_PRORATION_UPDATE,
        cancel_at_period_end: false,
        metadata: {
          ...stripeSub.metadata,
          docmind_user_id: input.userId,
          docmind_plan: targetPlan,
          plan: targetPlan,
        },
        expand: ["latest_invoice.payments.data.payment.payment_intent"],
      });

      verified = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId, {
        expand: [...PLAN_CHANGE_RETRIEVE_EXPAND],
      });

      invoice = asInvoice(verified.latest_invoice);
      if (!invoice && typeof verified.latest_invoice === "string") {
        invoice = await stripe.invoices.retrieve(verified.latest_invoice, {
          expand: ["payments.data.payment.payment_intent"],
        });
      }
      paymentIntent = await resolveInvoicePaymentIntent(stripe, invoice);
    } catch (error) {
      try {
        await syncUserSubscriptionFromStripe(input.userId);
      } catch {
        // garde l’état local si resync impossible
      }
      throw toStripeBillingAppError(error);
    }

    const paymentState = classifyPlanChangePayment({
      subscription: verified,
      invoice,
      paymentIntent,
    });
    const immediateInvoice = invoice ? toImmediateInvoice(invoice) : null;

    if (paymentState === "action_required") {
      // Ne jamais apply le nouveau plan : resync = price actuel (ancien).
      try {
        await syncUserSubscriptionFromStripe(input.userId);
      } catch {
        // ignore
      }
      const url = await resolvePlanChangeActionUrl(
        stripe,
        invoice,
        sub.stripeCustomerId,
      );
      return {
        outcome: "action_required",
        url,
        targetPlan,
        immediateInvoice,
      };
    }

    if (paymentState === "failed") {
      try {
        await syncUserSubscriptionFromStripe(input.userId);
      } catch {
        // ignore
      }
      throw new AppError(
        "BAD_REQUEST",
        "Le paiement du prorata a échoué ou a été annulé. Votre plan actuel n’a pas été modifié — mettez à jour votre carte via le portail Stripe.",
        402,
      );
    }

    // settled — price Stripe doit déjà être la cible
    assertStripePlanMatches(verified, targetPlan);
    if (invoice) {
      assertProrationInvoiceSettled(invoice, targetPlan);
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

    return {
      outcome: "applied",
      plan: appliedPlan,
      immediateInvoice,
    };
  };

  if (options?.skipLock) {
    return execute();
  }

  return withKeyedLock(`billing:checkout:${input.userId}`, execute);
}
