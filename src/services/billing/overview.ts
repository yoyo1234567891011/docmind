import { getBillingPlan } from "@/config/billing";
import { isStripeConfigured } from "@/lib/stripe";
import {
  hasPremiumAccess,
  resolveAccessBadge,
} from "@/services/billing/access";
import {
  entitlementsFailOpen,
  getUserEntitlements,
} from "@/services/billing/entitlements";
import { listUserInvoices } from "@/services/billing/invoices";
import { getUserSubscription } from "@/services/billing/store";
import { syncUserSubscriptionFromStripe } from "@/services/billing/sync";
import type { BillingOverview } from "@/types/billing";

/** Évite un appel Stripe à chaque GET (dashboard + facturation). */
const RECONCILE_MIN_INTERVAL_MS = 45_000;

function shouldReconcile(subscription: {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  lastWebhookAt: string | null;
}): boolean {
  if (!subscription.stripeCustomerId && !subscription.stripeSubscriptionId) {
    return false;
  }
  if (!subscription.lastWebhookAt) return true;
  const age = Date.now() - new Date(subscription.lastWebhookAt).getTime();
  return Number.isNaN(age) || age >= RECONCILE_MIN_INTERVAL_MS;
}

export async function getBillingOverview(
  userId: string,
  options?: { reconcile?: boolean },
): Promise<BillingOverview> {
  let subscription = await getUserSubscription(userId);
  const stripeConfigured = isStripeConfigured();

  // Sans webhook local : réconcilier périodiquement (activation / annulation portal).
  if (
    options?.reconcile !== false &&
    stripeConfigured &&
    shouldReconcile(subscription)
  ) {
    try {
      await syncUserSubscriptionFromStripe(userId);
      subscription = await getUserSubscription(userId);
    } catch {
      // garde l’état local si Stripe indisponible
    }
  }

  const entitlements = await getUserEntitlements(userId, { reconcile: false });
  const entitlementsDevBypass = entitlementsFailOpen();
  const isPremium = entitlementsDevBypass
    ? true
    : hasPremiumAccess(subscription.plan, subscription.status, {
        currentPeriodEnd: subscription.currentPeriodEnd,
      });
  const plan = getBillingPlan(isPremium ? "premium" : "free");
  const invoices = await listUserInvoices(userId);
  const accessBadge = resolveAccessBadge(subscription, {
    entitlementsDevBypass,
  });

  return {
    subscription,
    plan,
    entitlements,
    isPremium,
    accessBadge,
    stripeConfigured,
    entitlementsDevBypass,
    invoices,
  };
}
