import type { BillingEntitlement, BillingPlanDefinition } from "@/types/billing";

const FREE_ENTITLEMENTS: BillingEntitlement[] = [
  "analyze",
  "memory",
  "search",
  "alerts",
  "documents",
];

const PREMIUM_ENTITLEMENTS: BillingEntitlement[] = [
  ...FREE_ENTITLEMENTS,
  "letter_agent",
  "priority_support",
];

/**
 * Catalogue offres DocMind.
 * Prix Stripe : STRIPE_PRICE_PREMIUM (price_xxx) dans .env
 */
export const BILLING_PLANS: Record<"free" | "premium", BillingPlanDefinition> = {
  free: {
    id: "free",
    name: "Gratuit",
    description: "Analyse locale, fiches, alertes et bibliothèque.",
    priceMonthlyEur: null,
    stripe: false,
    entitlements: FREE_ENTITLEMENTS,
    features: [
      "Analyses PDF en local",
      "Mémoire documentaire & recherche",
      "Alertes échéances / risques",
      "Gestionnaire de documents",
      "1 compte personnel",
    ],
  },
  premium: {
    id: "premium",
    name: "Premium",
    description: "Courriers IA, support prioritaire et facturation Stripe.",
    priceMonthlyEur: 19,
    stripe: true,
    entitlements: PREMIUM_ENTITLEMENTS,
    features: [
      "Tout l’offre Gratuite",
      "Agent courrier (résiliation, contestation…)",
      "Portail facturation Stripe",
      "Support prioritaire",
      "Nouveautés en avant-première",
    ],
  },
} as const;

export function getBillingPlan(planId: "free" | "premium"): BillingPlanDefinition {
  return BILLING_PLANS[planId];
}

export function getStripePremiumPriceId(): string | undefined {
  return process.env.STRIPE_PRICE_PREMIUM?.trim() || undefined;
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
