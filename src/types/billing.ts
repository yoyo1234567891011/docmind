/** Plans produit DocMind. */
export type BillingPlanId =
  | "free"
  | "basique"
  | "pro"
  | "premium"
  | "extra";

export const PAID_BILLING_PLAN_IDS = [
  "basique",
  "pro",
  "premium",
  "extra",
] as const;

export type PaidBillingPlanId = (typeof PAID_BILLING_PLAN_IDS)[number];

export type BillingSubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "unpaid"
  | "paused";

export type BillingEntitlement =
  | "analyze"
  | "memory"
  | "search"
  | "alerts"
  | "documents"
  | "letter_agent"
  | "priority_support";

export type BillingAccessBadgeId =
  | "free"
  | "paid_active"
  | "premium_active"
  | "trialing"
  | "past_due"
  | "canceling"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "paused"
  | "dev_premium";

export interface BillingAccessBadge {
  id: BillingAccessBadgeId;
  label: string;
  tone: "success" | "info" | "warning" | "danger" | "neutral";
  description: string;
}

export interface BillingPlanDefinition {
  id: BillingPlanId;
  name: string;
  description: string;
  /** Prix affiché (EUR). null = gratuit */
  priceMonthlyEur: number | null;
  features: string[];
  entitlements: BillingEntitlement[];
  /** true = plan payant Stripe */
  stripe: boolean;
  /** Offre mise en avant (landing / facturation). */
  highlighted?: boolean;
}

export interface UserSubscriptionRecord {
  userId: string;
  plan: BillingPlanId;
  /** Statut Stripe synchronisé via webhooks (source de vérité locale). */
  status: BillingSubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  /** Présence d’un customer Stripe (IDs bruts non exposés au client). */
  hasStripeCustomer?: boolean;
  /** Présence d’une subscription Stripe (IDs bruts non exposés au client). */
  hasStripeSubscription?: boolean;
  currentPeriodStart: string | null;
  /** Prochaine date de renouvellement (fin de période courante). */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Date de fin / annulation effective si connue. */
  canceledAt: string | null;
  /** Dernier événement webhook appliqué (audit). */
  lastWebhookEventId: string | null;
  lastWebhookEventType: string | null;
  lastWebhookAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface BillingInvoiceSummary {
  id: string;
  number: string | null;
  status: string | null;
  amountDue: number;
  amountPaid: number;
  currency: string;
  createdAt: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface BillingOverview {
  subscription: UserSubscriptionRecord;
  plan: BillingPlanDefinition;
  entitlements: BillingEntitlement[];
  /**
   * Accès payant effectif (plan ≠ free + status OK).
   * Conservé pour compat UI ; préférer `effectivePlan` / entitlements.
   */
  isPremium: boolean;
  /** Plan effectif pour quotas / UI (free si période expirée / status invalide). */
  effectivePlan: BillingPlanId;
  accessBadge: BillingAccessBadge;
  stripeConfigured: boolean;
  /** true si entitlements en mode dev fail-open (Stripe absent). */
  entitlementsDevBypass: boolean;
  invoices: BillingInvoiceSummary[];
}

export const EMPTY_FREE_SUBSCRIPTION = (
  userId: string,
  now = new Date().toISOString(),
): UserSubscriptionRecord => ({
  userId,
  plan: "free",
  status: "active",
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  stripePriceId: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  canceledAt: null,
  lastWebhookEventId: null,
  lastWebhookEventType: null,
  lastWebhookAt: null,
  updatedAt: now,
  createdAt: now,
});
