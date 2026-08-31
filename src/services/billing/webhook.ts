import type Stripe from "stripe";

import { readSubscriptionPriceId } from "@/services/billing/apply-subscription";
import { offsetDraftRenewalInvoiceToCatalog } from "@/services/billing/renewal-catalog";
import { getStripe, getStripeWebhookSecret, isStripeLiveMode } from "@/lib/stripe";
import { AppError } from "@/lib/errors";
import { trackAnalyticsEvent } from "@/services/analytics";
import { applyStripeSubscription } from "@/services/billing/apply-subscription";
import {
  findUserIdByStripeCustomerId,
  getUserSubscription,
  upsertSubscriptionPatch,
} from "@/services/billing/store";

async function resolveUserId(
  sub: Stripe.Subscription,
): Promise<string | null> {
  const fromMeta = sub.metadata?.docmind_user_id?.trim();
  if (fromMeta) return fromMeta;

  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) return null;
  return findUserIdByStripeCustomerId(customerId);
}

async function resolveUserIdFromCustomer(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): Promise<string | null> {
  const customerId =
    typeof customer === "string" ? customer : customer?.id ?? null;
  if (!customerId) return null;
  return findUserIdByStripeCustomerId(customerId);
}

async function recordWebhookMeta(
  userId: string,
  event: Stripe.Event,
): Promise<void> {
  await upsertSubscriptionPatch(
    userId,
    {
      lastWebhookEventId: event.id,
      lastWebhookEventType: event.type,
      lastWebhookAt: new Date(event.created * 1000).toISOString(),
    },
    { webhookCreatedSec: event.created },
  );
}

async function syncSubscription(
  sub: Stripe.Subscription,
  event?: Stripe.Event,
): Promise<boolean> {
  const hydrated = await ensureSubscriptionHydrated(sub);
  const userId = await resolveUserId(hydrated);
  if (!userId) return false;

  await applyStripeSubscription(
    userId,
    hydrated,
    event
      ? { id: event.id, type: event.type, created: event.created }
      : undefined,
  );
  return true;
}

/** Payload webhook 2026-06-24 parfois sans items — retrieve Stripe si besoin. */
async function ensureSubscriptionHydrated(
  sub: Stripe.Subscription,
): Promise<Stripe.Subscription> {
  if (readSubscriptionPriceId(sub)) return sub;
  try {
    const stripe = getStripe();
    return await stripe.subscriptions.retrieve(sub.id, {
      expand: ["items.data.price"],
    });
  } catch {
    return sub;
  }
}

export function stripeWebhookLogContext(event: Stripe.Event): {
  eventId: string;
  eventType: string;
  livemode: boolean;
  customer: string | null;
  userId: string | null;
} {
  const obj = event.data.object as {
    customer?: string | { id?: string } | null;
    metadata?: { docmind_user_id?: string };
  };
  const customer =
    typeof obj.customer === "string"
      ? obj.customer
      : obj.customer?.id ?? null;
  return {
    eventId: event.id,
    eventType: event.type,
    livemode: event.livemode,
    customer,
    userId: obj.metadata?.docmind_user_id?.trim() || null,
  };
}

/**
 * Remboursement complet → révocation immédiate des droits Premium locaux
 * (+ tentative d’annulation de l’abonnement Stripe si encore actif).
 */
async function revokePremiumAfterFullRefund(
  userId: string,
  event: Stripe.Event,
  options?: { stripeSubscriptionId?: string | null },
): Promise<void> {
  const previous = await getUserSubscription(userId);
  const now = new Date().toISOString();

  // Ordre sous mutex : un refund ancien ne doit pas écraser un renewal/cancel plus récent.
  const applied = await upsertSubscriptionPatch(
    userId,
    {
      plan: "free",
      status: "canceled",
      cancelAtPeriodEnd: false,
      canceledAt: previous.canceledAt ?? now,
      lastWebhookEventId: event.id,
      lastWebhookEventType: event.type,
      lastWebhookAt: new Date(event.created * 1000).toISOString(),
    },
    { webhookCreatedSec: event.created },
  );
  if (!applied) return;

  const stripeSubscriptionId =
    options?.stripeSubscriptionId ?? previous.stripeSubscriptionId;

  await trackAnalyticsEvent({
    name: "billing.refunded",
    userId,
    idempotencyKey: `billing.refunded:${event.id}`,
    meta: {
      plan: previous.plan,
      full: true,
      reason: "full_refund",
      source: event.type,
      stripeSubscriptionId,
    },
  });

  if (
    previous.plan !== "free" &&
    (previous.status === "active" ||
      previous.status === "trialing" ||
      previous.status === "past_due")
  ) {
    await trackAnalyticsEvent({
      name: "billing.churned",
      userId,
      idempotencyKey: `billing.churned:${event.id}`,
      meta: {
        plan: "free",
        status: "canceled",
        reason: "full_refund",
        source: event.type,
        stripeSubscriptionId,
      },
    });
  }

  const subId =
    options?.stripeSubscriptionId ?? previous.stripeSubscriptionId;
  if (!subId) return;

  try {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(subId);
    if (sub.status !== "canceled") {
      await stripe.subscriptions.cancel(subId);
    }
  } catch {
    // La révocation locale prime ; Stripe peut déjà être annulé.
  }
}

function isFullChargeRefund(charge: Stripe.Charge): boolean {
  if (!charge.paid) return false;
  if (charge.refunded) return true;
  const amount = charge.amount ?? 0;
  const refunded = charge.amount_refunded ?? 0;
  return amount > 0 && refunded >= amount;
}

async function handleChargeRefunded(
  event: Stripe.Event,
): Promise<{ handled: boolean }> {
  const charge = event.data.object as Stripe.Charge;
  if (!isFullChargeRefund(charge)) {
    const userId = await resolveUserIdFromCustomer(charge.customer);
    if (userId) {
      await recordWebhookMeta(userId, event);
      await trackAnalyticsEvent({
        name: "billing.refunded",
        userId,
        idempotencyKey: `billing.refunded:${event.id}`,
        meta: {
          full: false,
          reason: "partial_refund",
          source: event.type,
          // Montant en centimes — pas de PII
          amountRefunded: charge.amount_refunded ?? 0,
          currency: charge.currency ?? null,
        },
      });
    }
    return { handled: true };
  }

  const userId = await resolveUserIdFromCustomer(charge.customer);
  if (!userId) return { handled: false };

  let stripeSubscriptionId: string | null = null;
  const invoiceRef = (
    charge as Stripe.Charge & {
      invoice?: string | Stripe.Invoice | null;
    }
  ).invoice;
  if (invoiceRef) {
    try {
      const stripe = getStripe();
      const invoiceId =
        typeof invoiceRef === "string" ? invoiceRef : invoiceRef.id;
      const invoice = await stripe.invoices.retrieve(invoiceId);
      const sub = (
        invoice as { subscription?: string | { id: string } | null }
      ).subscription;
      stripeSubscriptionId =
        typeof sub === "string" ? sub : sub?.id ?? null;
    } catch {
      stripeSubscriptionId = null;
    }
  }

  await revokePremiumAfterFullRefund(userId, event, { stripeSubscriptionId });
  return { handled: true };
}

async function handleRefundCreated(
  event: Stripe.Event,
): Promise<{ handled: boolean }> {
  const refund = event.data.object as Stripe.Refund;
  const chargeId =
    typeof refund.charge === "string" ? refund.charge : refund.charge?.id;
  if (!chargeId) return { handled: false };

  const stripe = getStripe();
  const charge = await stripe.charges.retrieve(chargeId);
  if (!isFullChargeRefund(charge)) {
    const userId = await resolveUserIdFromCustomer(charge.customer);
    if (userId) {
      await recordWebhookMeta(userId, event);
      await trackAnalyticsEvent({
        name: "billing.refunded",
        userId,
        idempotencyKey: `billing.refunded:${event.id}`,
        meta: {
          full: false,
          reason: "partial_refund",
          source: event.type,
          amountRefunded: charge.amount_refunded ?? 0,
          currency: charge.currency ?? null,
        },
      });
    }
    return { handled: true };
  }

  return handleChargeRefunded({
    ...event,
    type: "charge.refunded",
    data: { ...event.data, object: charge },
  } as Stripe.Event);
}

async function handleDispute(
  event: Stripe.Event,
): Promise<{ handled: boolean }> {
  const dispute = event.data.object as Stripe.Dispute;
  const chargeId =
    typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
  if (!chargeId) return { handled: false };

  const stripe = getStripe();
  const charge = await stripe.charges.retrieve(chargeId);
  const userId = await resolveUserIdFromCustomer(charge.customer);
  if (!userId) return { handled: false };

  let stripeSubscriptionId: string | null = null;
  const invoiceRef = (
    charge as Stripe.Charge & { invoice?: string | Stripe.Invoice | null }
  ).invoice;
  if (invoiceRef) {
    try {
      const invoiceId =
        typeof invoiceRef === "string" ? invoiceRef : invoiceRef.id;
      const invoice = await stripe.invoices.retrieve(invoiceId);
      const sub = (
        invoice as { subscription?: string | { id: string } | null }
      ).subscription;
      stripeSubscriptionId =
        typeof sub === "string" ? sub : sub?.id ?? null;
    } catch {
      stripeSubscriptionId = null;
    }
  }

  await revokePremiumAfterFullRefund(userId, event, { stripeSubscriptionId });
  return { handled: true };
}

export function constructStripeEvent(
  rawBody: string | Buffer,
  signature: string,
): Stripe.Event {
  const secret = getStripeWebhookSecret();
  if (!secret) {
    throw new AppError(
      "BAD_REQUEST",
      "STRIPE_WEBHOOK_SECRET manquant.",
      503,
    );
  }
  const stripe = getStripe();
  const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  if (event.livemode !== isStripeLiveMode()) {
    throw new AppError(
      "BAD_REQUEST",
      "Webhook Stripe ignoré : mode live/test incompatible avec la clé API.",
      400,
    );
  }
  return event;
}

export type StripeWebhookProcessDeps = {
  isClaimed: (eventId: string) => Promise<boolean>;
  claim: (eventId: string, eventType: string) => Promise<boolean>;
  dispatch: (event: Stripe.Event) => Promise<{ handled: boolean }>;
};

/**
 * Cœur idempotent (testable) :
 * - single-flight par event.id (caller)
 * - claim définitif UNIQUEMENT après succès réel (handled:true)
 * - crash avant claim → pas de claim → Stripe/retry peut rejouer
 */
export async function processStripeWebhookEvent(
  event: Stripe.Event,
  deps: StripeWebhookProcessDeps,
): Promise<{ handled: boolean }> {
  // Claim APRÈS succès : un crash mid-dispatch laisse Stripe retry (pas d’événement fantôme).
  if (await deps.isClaimed(event.id)) {
    return { handled: true };
  }

  const result = await deps.dispatch(event);
  if (result.handled) {
    await deps.claim(event.id, event.type);
  }
  // handled:false → pas de claim → retry Stripe possible (ex. userId non résolu)
  return result;
}

/**
 * Traite les événements Stripe utiles à l’abonnement DocMind.
 * Les droits Premium sont toujours dérivés de l’état synchronisé (webhooks).
 */
export async function handleStripeWebhookEvent(
  event: Stripe.Event,
): Promise<{ handled: boolean }> {
  const { withKeyedLock } = await import("@/lib/keyed-lock");
  const {
    claimStripeWebhookEvent,
    isStripeWebhookEventClaimed,
  } = await import("@/services/persistence/webhook-events-pg");

  // Un seul worker dispatch pour un event.id (Redis NX si configuré).
  return withKeyedLock(
    `billing:webhook:${event.id}`,
    () =>
      processStripeWebhookEvent(event, {
        isClaimed: isStripeWebhookEventClaimed,
        claim: claimStripeWebhookEvent,
        dispatch: dispatchStripeWebhookEvent,
      }),
    { ttlMs: 120_000 },
  );
}

async function dispatchStripeWebhookEvent(
  event: Stripe.Event,
): Promise<{ handled: boolean }> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") return { handled: false };
      const subId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      if (!subId) return { handled: false };
      const stripe = getStripe();
      const sub = await stripe.subscriptions.retrieve(subId);
      if (session.client_reference_id || session.metadata?.docmind_user_id) {
        sub.metadata = {
          ...sub.metadata,
          docmind_user_id:
            session.metadata?.docmind_user_id ||
            session.client_reference_id ||
            "",
        };
      }
      return { handled: await syncSubscription(sub, event) };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      return {
        handled: await syncSubscription(
          event.data.object as Stripe.Subscription,
          event,
        ),
      };
    }
    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.payment_action_required": {
      const invoice = event.data.object as Stripe.Invoice;
      const subId =
        typeof (invoice as { subscription?: string | { id: string } })
          .subscription === "string"
          ? ((invoice as { subscription?: string }).subscription as string)
          : (invoice as { subscription?: { id: string } }).subscription?.id;
      if (!subId) return { handled: false };
      const stripe = getStripe();
      const sub = await stripe.subscriptions.retrieve(subId);
      const synced = await syncSubscription(sub, event);

      if (event.type === "invoice.paid") {
        const billingReason =
          (invoice as { billing_reason?: string | null }).billing_reason ??
          null;
        // Renouvellement de cycle (pas la 1ʳᵉ facture de création)
        if (billingReason === "subscription_cycle") {
          const userId = await resolveUserId(sub);
          if (userId) {
            await trackAnalyticsEvent({
              name: "billing.renewed",
              userId,
              idempotencyKey: `billing.renewed:${invoice.id}`,
              meta: {
                plan: "premium",
                source: "invoice.paid",
                billingReason,
                stripeSubscriptionId: subId,
                stripeInvoiceId: invoice.id,
                amountPaid: invoice.amount_paid ?? null,
                currency: invoice.currency ?? null,
              },
            });
          }
        }
      }
      return { handled: synced };
    }
    case "invoice.created": {
      const invoice = event.data.object as Stripe.Invoice;
      try {
        const stripe = getStripe();
        await offsetDraftRenewalInvoiceToCatalog(stripe, invoice);
      } catch {
        // ne bloque pas le webhook
      }
      return { handled: true };
    }
    case "charge.refunded":
      return handleChargeRefunded(event);
    case "refund.created":
      return handleRefundCreated(event);
    case "charge.dispute.created":
    case "charge.dispute.funds_withdrawn":
      return handleDispute(event);
    default:
      return { handled: false };
  }
}
