import { getBillingPlan } from "@/config/billing";
import type { PaidBillingPlanId } from "@/types/billing";

/**
 * Règle produit : changement payant → payant = prix catalogue PLEIN du plan cible.
 *
 * Approche Stripe :
 * - `proration_behavior: "none"` → pas de crédit/débit au prorata des jours restants
 * - `billing_cycle_anchor: "now"` → nouvelle période mensuelle qui démarre aujourd’hui
 * - `payment_behavior: "error_if_incomplete"` → échec carte = pas de changement d’abo
 *
 * Stripe facture immédiatement le montant récurrent complet du nouveau price (ex. 59,99 €
 * pour Extra), pas une « différence » entre ancien et nouveau plan.
 */
export const PLAN_CHANGE_FULL_PRICE_UPDATE = {
  proration_behavior: "none" as const,
  billing_cycle_anchor: "now" as const,
  payment_behavior: "error_if_incomplete" as const,
};

export const PLAN_CHANGE_PREVIEW_SUBSCRIPTION_DETAILS = {
  proration_behavior: "none" as const,
  billing_cycle_anchor: "now" as const,
};

export function catalogPlanMonthlyEur(plan: PaidBillingPlanId): number {
  const monthly = getBillingPlan(plan).priceMonthlyEur;
  if (monthly == null) {
    throw new Error(`Prix catalogue manquant pour le plan ${plan}.`);
  }
  return monthly;
}

/** Tolérance centimes (arrondis Stripe). */
export function catalogChargeMatchesInvoice(
  catalogEur: number,
  invoiceEur: number,
  toleranceEur = 0.05,
): boolean {
  return Math.abs(catalogEur - invoiceEur) <= toleranceEur;
}
