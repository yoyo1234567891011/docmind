import type Stripe from "stripe";

import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { AppError } from "@/lib/errors";
import {
  applyStripeSubscription,
} from "@/services/billing/apply-subscription";
import {
  getUserSubscription,
  upsertSubscriptionPatch,
} from "@/services/billing/store";
import type { UserSubscriptionRecord } from "@/types/billing";

function pickBestSubscription(
  subscriptions: Stripe.Subscription[],
): Stripe.Subscription | null {
  if (subscriptions.length === 0) return null;
  const rank = (status: string): number => {
    if (status === "active") return 0;
    if (status === "trialing") return 1;
    if (status === "past_due") return 2;
    if (status === "unpaid") return 3;
    if (status === "paused") return 4;
    if (status === "incomplete") return 5;
    return 9;
  };
  return [...subscriptions].sort((a, b) => rank(a.status) - rank(b.status))[0];
}

/**
 * Resynchronise l’abonnement local depuis Stripe (utile sans webhook local).
 */
export async function syncUserSubscriptionFromStripe(
  userId: string,
  options?: { checkoutSessionId?: string | null },
): Promise<{
  subscription: UserSubscriptionRecord;
  synced: boolean;
  source: "checkout_session" | "customer" | "none";
}> {
  if (!isStripeConfigured()) {
    const subscription = await getUserSubscription(userId);
    return { subscription, synced: false, source: "none" };
  }

  const stripe = getStripe();
  let sub: Stripe.Subscription | null = null;
  let source: "checkout_session" | "customer" | "none" = "none";

  const sessionId = options?.checkoutSessionId?.trim();
  if (sessionId) {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });
    const sessionUser =
      session.client_reference_id?.trim() ||
      session.metadata?.docmind_user_id?.trim() ||
      null;
    if (!sessionUser) {
      throw new AppError(
        "FORBIDDEN",
        "Session Checkout sans lien utilisateur — synchronisation refusée.",
        403,
      );
    }
    if (sessionUser !== userId) {
      throw new AppError(
        "FORBIDDEN",
        "Cette session Checkout ne correspond pas à votre compte.",
        403,
      );
    }

    const rawSub = session.subscription;
    if (typeof rawSub === "string") {
      sub = await stripe.subscriptions.retrieve(rawSub);
      source = "checkout_session";
    } else if (rawSub && typeof rawSub === "object" && "id" in rawSub) {
      sub = rawSub as Stripe.Subscription;
      source = "checkout_session";
    }

    const customerId =
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id;
    if (customerId) {
      await upsertSubscriptionPatch(userId, {
        stripeCustomerId: customerId,
      });
    }
  }

  if (!sub) {
    const current = await getUserSubscription(userId);

    if (current.stripeSubscriptionId) {
      try {
        sub = await stripe.subscriptions.retrieve(current.stripeSubscriptionId);
        source = "customer";
      } catch {
        sub = null;
      }
    }

    if (!sub) {
      const customerId = current.stripeCustomerId;
      if (!customerId) {
        return { subscription: current, synced: false, source: "none" };
      }

      const list = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 20,
      });
      sub = pickBestSubscription(list.data);
      source = sub ? "customer" : "none";
    }
  }

  if (!sub) {
    const subscription = await getUserSubscription(userId);
    return { subscription, synced: false, source: "none" };
  }

  // Garantit le lien user (sans forcer plan=premium — dérivé du price Stripe)
  if (!sub.metadata?.docmind_user_id) {
    sub.metadata = {
      ...sub.metadata,
      docmind_user_id: userId,
    };
  }

  await applyStripeSubscription(userId, sub, {
    id: `sync_${sub.id}`,
    type: "sync.stripe",
    created: Math.floor(Date.now() / 1000),
  });

  const subscription = await getUserSubscription(userId);
  return { subscription, synced: true, source };
}
