import type {
  BillingAccessBadge,
  BillingPlanId,
  BillingSubscriptionStatus,
  UserSubscriptionRecord,
} from "@/types/billing";

/**
 * Droits Premium dérivés du couple (plan, status Stripe) — jamais d’un booléen isolé.
 * - active / trialing : accès Premium
 * - past_due : grâce (relances Stripe)
 * - cancel_at_period_end + active : accès jusqu’à currentPeriodEnd
 * - période expirée (currentPeriodEnd < now) : plus d’accès, même si status local encore active
 * - unpaid / canceled / incomplete / paused : pas d’accès Premium
 */
export function hasPremiumAccess(
  plan: BillingPlanId,
  status: BillingSubscriptionStatus | string,
  period?: { currentPeriodEnd?: string | null; now?: number },
): boolean {
  if (plan !== "premium") return false;
  if (
    !(status === "active" || status === "trialing" || status === "past_due")
  ) {
    return false;
  }
  const endRaw = period?.currentPeriodEnd;
  if (endRaw) {
    const end = Date.parse(endRaw);
    const now = period?.now ?? Date.now();
    if (Number.isFinite(end) && end < now) return false;
  }
  return true;
}

/** Alias — remplace l’ancien isPremiumStatus basé sur un booléen stocké. */
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
      label: "Premium (dev)",
      tone: "info",
      description: "Stripe non configuré — entitlements Premium en local.",
    };
  }

  const { plan, status, cancelAtPeriodEnd } = subscription;

  if (status === "unpaid") {
    return {
      id: "unpaid",
      label: "Impayé",
      tone: "danger",
      description: "Paiement échoué — droits Premium révoqués.",
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

  // Annulation planifiée — avant Essai / Actif (cancel_at_period_end ou cancel_at).
  if (
    plan === "premium" &&
    (status === "active" || status === "trialing") &&
    cancelAtPeriodEnd
  ) {
    return {
      id: "canceling",
      label: "Expire bientôt",
      tone: "warning",
      description:
        "Renouvellement annulé — Premium actif jusqu’à la date indiquée.",
    };
  }

  if (status === "trialing" && plan === "premium") {
    return {
      id: "trialing",
      label: "Essai",
      tone: "info",
      description: "Période d’essai Stripe en cours.",
    };
  }

  if (status === "past_due" && plan === "premium") {
    return {
      id: "past_due",
      label: "Paiement en retard",
      tone: "warning",
      description: "Accès maintenu pendant les relances Stripe.",
    };
  }

  if (plan === "premium" && status === "active") {
    return {
      id: "premium_active",
      label: "Premium actif",
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
