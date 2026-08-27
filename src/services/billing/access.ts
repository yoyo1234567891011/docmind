import type {
  BillingAccessBadge,
  BillingPlanId,
  BillingSubscriptionStatus,
  UserSubscriptionRecord,
} from "@/types/billing";
import { isPaidBillingPlanId, normalizeBillingPlanId } from "@/config/billing";

function statusAllowsPaidAccess(
  status: BillingSubscriptionStatus | string,
): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}

function periodStillValid(period?: {
  currentPeriodEnd?: string | null;
  now?: number;
}): boolean {
  const endRaw = period?.currentPeriodEnd;
  if (!endRaw) return true;
  const end = Date.parse(endRaw);
  const now = period?.now ?? Date.now();
  if (Number.isFinite(end) && end < now) return false;
  return true;
}

/**
 * Accès payant effectif (plan ≠ free + status Stripe OK + période non expirée).
 * Remplace l’ancien binaire Premium-only.
 */
export function hasPaidAccess(
  plan: BillingPlanId,
  status: BillingSubscriptionStatus | string,
  period?: { currentPeriodEnd?: string | null; now?: number },
): boolean {
  if (!isPaidBillingPlanId(plan)) return false;
  if (!statusAllowsPaidAccess(status)) return false;
  return periodStillValid(period);
}

/**
 * Plan effectif pour quotas / entitlements.
 * Si le statut / la période n’autorise plus l’accès → free.
 */
export function resolveEffectivePlan(
  plan: BillingPlanId,
  status: BillingSubscriptionStatus | string,
  period?: { currentPeriodEnd?: string | null; now?: number },
): BillingPlanId {
  const normalized = normalizeBillingPlanId(plan);
  if (!hasPaidAccess(normalized, status, period)) return "free";
  return normalized;
}

/**
 * Compat : ancien « Premium » = tout plan payant actif.
 * @deprecated Prefer hasPaidAccess / resolveEffectivePlan
 */
export function hasPremiumAccess(
  plan: BillingPlanId,
  status: BillingSubscriptionStatus | string,
  period?: { currentPeriodEnd?: string | null; now?: number },
): boolean {
  return hasPaidAccess(plan, status, period);
}

/** Alias historique. */
export const isPremiumStatus = hasPremiumAccess;

export function resolveAccessBadge(
  subscription: Pick<
    UserSubscriptionRecord,
    | "plan"
    | "status"
    | "cancelAtPeriodEnd"
    | "currentPeriodEnd"
    | "canceledAt"
    | "stripeSubscriptionId"
  >,
  options?: { entitlementsDevBypass?: boolean },
): BillingAccessBadge {
  if (options?.entitlementsDevBypass) {
    return {
      id: "dev_premium",
      label: "Pro (dev)",
      tone: "info",
      description: "Stripe non configuré — entitlements Pro+ en local.",
    };
  }

  const plan = normalizeBillingPlanId(subscription.plan);
  const { status, cancelAtPeriodEnd } = subscription;
  const paid = isPaidBillingPlanId(plan);

  if (status === "unpaid") {
    return {
      id: "unpaid",
      label: "Impayé",
      tone: "danger",
      description: "Paiement échoué — droits payants révoqués.",
    };
  }

  if (status === "canceled") {
    return {
      id: "canceled",
      label: "Annulé",
      tone: "neutral",
      description: "Abonnement annulé — offre Gratuite.",
    };
  }

  if (
    paid &&
    (status === "active" || status === "trialing") &&
    cancelAtPeriodEnd
  ) {
    return {
      id: "canceling",
      label: "Expire bientôt",
      tone: "warning",
      description:
        "Renouvellement annulé — accès actif jusqu’à la date indiquée.",
    };
  }

  if (status === "trialing" && paid) {
    return {
      id: "trialing",
      label: "Essai",
      tone: "info",
      description: "Période d’essai Stripe en cours.",
    };
  }

  if (status === "past_due" && paid) {
    return {
      id: "past_due",
      label: "Paiement en retard",
      tone: "warning",
      description: "Accès maintenu pendant les relances Stripe.",
    };
  }

  if (paid && status === "active") {
    const labelByPlan: Record<string, string> = {
      basique: "Basique actif",
      pro: "Pro actif",
      premium: "Premium actif",
      extra: "Extra actif",
    };
    return {
      id: plan === "premium" || plan === "extra" ? "premium_active" : "paid_active",
      label: labelByPlan[plan] ?? "Abonnement actif",
      tone: "success",
      description: "Abonnement Stripe actif.",
    };
  }

  if (status === "incomplete" || status === "paused") {
    return {
      id: status,
      label: status === "paused" ? "En pause" : "Incomplet",
      tone: "warning",
      description: "Abonnement non pleinement actif.",
    };
  }

  return {
    id: "free",
    label: "Gratuit",
    tone: "neutral",
    description: "Offre Gratuite.",
  };
}

export function stripeStatusLabel(status: string): string {
  const map: Record<string, string> = {
    active: "Actif",
    trialing: "Essai",
    past_due: "Paiement en retard",
    canceled: "Annulé",
    incomplete: "Incomplet",
    unpaid: "Impayé",
    paused: "En pause",
  };
  return map[status] ?? status;
}
