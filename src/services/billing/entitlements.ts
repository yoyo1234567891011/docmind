import {
  getBillingPlan,
  isPaidBillingPlanId,
} from "@/config/billing";
import { isDeployedEnv } from "@/lib/env-validate";
import { isStripeConfigured } from "@/lib/stripe";
import {
  hasPaidAccess,
  resolveEffectivePlan,
} from "@/services/billing/access";
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
  if (isDeployedEnv()) return false;
  if (process.env.BILLING_ENTITLEMENTS_FAIL_OPEN === "1") return true;
  if (process.env.BILLING_ENTITLEMENTS_FAIL_OPEN === "0") return false;
  return true;
}

/** @deprecated Prefer hasPaidAccess */
export function isPremiumStatus(
  plan: BillingPlanId,
  status: string,
): boolean {
  return hasPaidAccess(plan, status);
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
    // Dev local : Pro (courrier) sans Stripe.
    return getBillingPlan("pro").entitlements;
  }

  if (!isStripeConfigured()) {
    return getBillingPlan("free").entitlements;
  }

  if (options?.reconcile !== false) {
    await maybeReconcileSubscription(userId);
  }

  const sub = await getUserSubscription(userId);
  const effective = resolveEffectivePlan(sub.plan, sub.status, {
    currentPeriodEnd: sub.currentPeriodEnd,
  });
  return getBillingPlan(effective).entitlements;
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
    const upgradeHint =
      entitlement === "letter_agent"
        ? "Cette fonctionnalité nécessite l’offre Pro ou supérieure. Choisissez un plan depuis Facturation."
        : "Cette fonctionnalité nécessite un abonnement payant. Passez à un plan depuis Facturation.";
    throw new AppError("FORBIDDEN", upgradeHint, 403);
  }
}

export function planHasLetterAgent(plan: BillingPlanId): boolean {
  return getBillingPlan(plan).entitlements.includes("letter_agent");
}

export function planIsPaid(plan: BillingPlanId): boolean {
  return isPaidBillingPlanId(plan);
}
