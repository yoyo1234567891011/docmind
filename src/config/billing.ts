import type {
  BillingEntitlement,
  BillingPlanDefinition,
  BillingPlanId,
  PaidBillingPlanId,
} from "@/types/billing";
import { PAID_BILLING_PLAN_IDS } from "@/types/billing";

const CORE_ENTITLEMENTS: BillingEntitlement[] = [
  "analyze",
  "memory",
  "search",
  "alerts",
  "documents",
];

const PRO_ENTITLEMENTS: BillingEntitlement[] = [
  ...CORE_ENTITLEMENTS,
  "letter_agent",
];

const PREMIUM_ENTITLEMENTS: BillingEntitlement[] = [
  ...PRO_ENTITLEMENTS,
  "priority_support",
];

/**
 * Catalogue offres DocMind (5 plans).
 * Prix Stripe : STRIPE_PRICE_BASIQUE | PRO | PREMIUM | EXTRA (price_xxx).
 */
export const BILLING_PLANS: Record<BillingPlanId, BillingPlanDefinition> = {
  free: {
    id: "free",
    name: "Gratuit",
    description: "Pour analyser vos premiers PDF et constituer votre mémoire.",
    priceMonthlyEur: null,
    stripe: false,
    entitlements: CORE_ENTITLEMENTS,
    features: [
      "5 analyses PDF par mois",
      "Résumé + points à surveiller",
      "Historique de base",
      "Max 30 pages / document",
      "Sans agent courrier",
    ],
  },
  basique: {
    id: "basique",
    name: "Basique",
    description: "Plus d’analyses et recherche intelligente.",
    priceMonthlyEur: 9.99,
    stripe: true,
    entitlements: CORE_ENTITLEMENTS,
    features: [
      "15 analyses PDF par mois",
      "Tout Gratuit",
      "Recherche intelligente",
      "Portail facturation Stripe",
      "Sans agent courrier",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    description: "Meilleur rapport qualité/prix — courriers IA inclus.",
    priceMonthlyEur: 19.99,
    stripe: true,
    highlighted: true,
    entitlements: PRO_ENTITLEMENTS,
    features: [
      "40 analyses PDF par mois",
      "Tout Basique",
      "Agent courrier (résiliation, contestation…)",
      "Meilleur rapport qualité/prix",
    ],
  },
  premium: {
    id: "premium",
    name: "Premium",
    description: "Volume confortable, support prioritaire et nouveautés.",
    priceMonthlyEur: 34.99,
    stripe: true,
    entitlements: PREMIUM_ENTITLEMENTS,
    features: [
      "75 analyses PDF par mois",
      "Tout Pro",
      "Support prioritaire",
      "Nouveautés en avant-première",
    ],
  },
  extra: {
    id: "extra",
    name: "Extra",
    description: "Volume élevé pour une utilisation intensive.",
    priceMonthlyEur: 59.99,
    stripe: true,
    entitlements: PREMIUM_ENTITLEMENTS,
    features: [
      "150 analyses PDF par mois",
      "Tout Premium",
      "Volume élevé",
    ],
  },
} as const;

export function getBillingPlan(planId: BillingPlanId): BillingPlanDefinition {
  return BILLING_PLANS[planId] ?? BILLING_PLANS.free;
}

export function isPaidBillingPlanId(plan: string): plan is PaidBillingPlanId {
  return (PAID_BILLING_PLAN_IDS as readonly string[]).includes(plan);
}

export function normalizeBillingPlanId(raw: unknown): BillingPlanId {
  if (typeof raw !== "string") return "free";
  const id = raw.trim().toLowerCase();
  if (id in BILLING_PLANS) return id as BillingPlanId;
  return "free";
}

function trimEnv(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

const PRICE_ENV_BY_PLAN: Record<PaidBillingPlanId, string> = {
  basique: "STRIPE_PRICE_BASIQUE",
  pro: "STRIPE_PRICE_PRO",
  premium: "STRIPE_PRICE_PREMIUM",
  extra: "STRIPE_PRICE_EXTRA",
};

export function getStripePriceIdForPlan(
  plan: PaidBillingPlanId,
): string | undefined {
  return trimEnv(PRICE_ENV_BY_PLAN[plan]);
}

/** @deprecated Prefer getStripePriceIdForPlan("premium") */
export function getStripePremiumPriceId(): string | undefined {
  return getStripePriceIdForPlan("premium");
}

/** Map price_xxx → plan payant (source de vérité webhook / sync). */
export function buildStripePriceToPlanMap(): Map<string, PaidBillingPlanId> {
  const map = new Map<string, PaidBillingPlanId>();
  for (const plan of PAID_BILLING_PLAN_IDS) {
    const priceId = getStripePriceIdForPlan(plan);
    if (priceId) map.set(priceId, plan);
  }
  return map;
}

export function planIdFromStripePriceId(
  priceId: string | null | undefined,
): BillingPlanId {
  if (!priceId) return "free";
  return buildStripePriceToPlanMap().get(priceId) ?? "free";
}

export function getAppBaseUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) return appUrl.replace(/\/$/, "");

  const env = (
    process.env.NEXT_PUBLIC_APP_ENV ||
    process.env.NODE_ENV ||
    "development"
  ).toLowerCase();
  if (env === "production" || env === "beta" || env === "staging") {
    throw new Error(
      "NEXT_PUBLIC_APP_URL est obligatoire en production/beta (redirections Stripe).",
    );
  }

  const fromEval = process.env.EVAL_BASE_URL?.trim();
  if (fromEval) return fromEval.replace(/\/$/, "");
  const port = process.env.PORT?.trim() || "3000";
  return `http://127.0.0.1:${port}`;
}

export function areStripePaidPricesConfigured(): boolean {
  return PAID_BILLING_PLAN_IDS.every((plan) =>
    Boolean(getStripePriceIdForPlan(plan)),
  );
}
