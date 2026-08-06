import { getBillingPlan } from "@/config/billing";
import { isDeployedEnv } from "@/lib/env-validate";
import { isStripeConfigured } from "@/lib/stripe";
import { hasPremiumAccess } from "@/services/billing/access";
import { getUserSubscription } from "@/services/billing/store";
import { syncUserSubscriptionFromStripe } from "@/services/billing/sync";
import type { BillingEntitlement, BillingPlanId } from "@/types/billing";

const ENTITLEMENT_RECONCILE_MS = 30_000;

/**
 * Sans Stripe : fail-open uniquement hors environnements déployés.
 * production / beta / staging → toujours fail-closed.
 */
export function entitlementsFailOpen(): boolean {
  if (isStripeConfigured()) return false;
  // Jamais de Premium fantôme en déployé, même avec FAIL_OPEN=1.
  if (isDeployedEnv()) return false;
  if (process.env.BILLING_ENTITLEMENTS_FAIL_OPEN === "1") return true;
  if (process.env.BILLING_ENTITLEMENTS_FAIL_OPEN === "0") return false;
  // development / test
  return true;
}

/** @deprecated Prefer hasPremiumAccess — conservé pour imports existants. */
export function isPremiumStatus(
  plan: BillingPlanId,
  status: string,
): boolean {
  return hasPremiumAccess(plan, status);
}

async function maybeReconcileSubscription(userId: string): Promise<void> {
  if (!isStripeConfigured()) return;
  const sub = await getUserSubscription(userId);
  if (!sub.stripeCustomerId && !sub.stripeSubscriptionId) return;

  if (sub.lastWebhookAt) {
    const age = Date.now() - new Date(sub.lastWebhookAt).getTime();
    if (!Number.isNaN(age) && age < ENTITLEMENT_RECONCILE_MS) return;
  }

  try {
    await syncUserSubscriptionFromStripe(userId);
  } catch {
    // garde l’état local
  }
}

export async function getUserEntitlements(
  userId: string,
  options?: { reconcile?: boolean },
): Promise<BillingEntitlement[]> {
  if (entitlementsFailOpen()) {
    return getBillingPlan("premium").entitlements;
  }

  if (!isStripeConfigured()) {
    // Prod sans Stripe : pas de Premium fantôme
    return getBillingPlan("free").entitlements;
  }

  if (options?.reconcile !== false) {
    await maybeReconcileSubscription(userId);
  }

  const sub = await getUserSubscription(userId);
  if (
    hasPremiumAccess(sub.plan, sub.status, {
      currentPeriodEnd: sub.currentPeriodEnd,
    })
  ) {
    return getBillingPlan("premium").entitlements;
  }
  return getBillingPlan("free").entitlements;
}

export async function hasEntitlement(
  userId: string,
  entitlement: BillingEntitlement,
  options?: { reconcile?: boolean },
): Promise<boolean> {
  const list = await getUserEntitlements(userId, options);
  return list.includes(entitlement);
}

export async function requireEntitlement(
  userId: string,
  entitlement: BillingEntitlement,
): Promise<void> {
  const { AppError } = await import("@/lib/errors");
  const ok = await hasEntitlement(userId, entitlement, { reconcile: true });
  if (!ok) {
    throw new AppError(
      "FORBIDDEN",
      "Cette fonctionnalité nécessite l’offre Premium. Passez à Premium depuis Facturation.",
      403,
    );
  }
}
