import { AppError } from "@/lib/errors";
import { getBillingPlan } from "@/config/billing";
import type { PaidBillingPlanId } from "@/types/billing";
import type Stripe from "stripe";

/**
 * Règle produit : changement payant → payant = prix catalogue PLEIN du plan cible.
 *
 * Approche Stripe :
 * - `proration_behavior: "none"` → pas de crédit/débit au prorata des jours restants
 * - `billing_cycle_anchor: "now"` → nouvelle période mensuelle qui démarre aujourd’hui
 * - `payment_behavior: "error_if_incomplete"` → échec carte = pas de changement d’abo
 * - solde client remis à zéro avant update → un crédit prorata résiduel ne réduit pas
 *   le prélèvement carte (sinon 59,99 € − 24,97 € crédit = 35,02 € malgré la ligne plein tarif)
 *
 * Stripe facture immédiatement le montant récurrent complet du nouveau price (ex. 59,99 €
 * pour Extra), et la carte est débitée de ce montant exact.
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

export function invoiceGrossEur(invoice: Stripe.Invoice): number {
  return (invoice.total ?? invoice.subtotal ?? 0) / 100;
}

export function invoiceCardPaidEur(invoice: Stripe.Invoice): number {
  return (invoice.amount_paid ?? 0) / 100;
}

/**
 * Remet le solde client Stripe à 0 avant changement de plan.
 * Un crédit négatif (ex. −24,97 € de prorata) serait sinon déduit de la facture.
 */
export async function clearCustomerBalanceBeforeFullPriceChange(
  stripe: Stripe,
  customerId: string,
): Promise<{ clearedCreditEur: number; clearedDebitEur: number }> {
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) {
    return { clearedCreditEur: 0, clearedDebitEur: 0 };
  }

  const balanceCents = customer.balance ?? 0;
  if (balanceCents === 0) {
    return { clearedCreditEur: 0, clearedDebitEur: 0 };
  }

  await stripe.customers.createBalanceTransaction(customerId, {
    amount: -balanceCents,
    currency: (customer.currency ?? "eur").toLowerCase(),
    description:
      "Réinitialisation solde avant changement de plan DocMind (prix catalogue plein)",
  });

  return {
    clearedCreditEur: balanceCents < 0 ? Math.abs(balanceCents) / 100 : 0,
    clearedDebitEur: balanceCents > 0 ? balanceCents / 100 : 0,
  };
}

/** Vérifie que la carte a été débitée du prix catalogue, pas d’un net après crédit. */
export function assertFullCatalogInvoiceCharged(
  invoice: Stripe.Invoice,
  catalogEur: number,
  targetPlan: PaidBillingPlanId,
): void {
  const grossEur = invoiceGrossEur(invoice);
  if (!catalogChargeMatchesInvoice(catalogEur, grossEur)) {
    throw new AppError(
      "INTERNAL_ERROR",
      `Ligne facture (${grossEur} €) différente du prix catalogue ${targetPlan} (${catalogEur} €).`,
      502,
    );
  }

  const startingBalanceCents = invoice.starting_balance ?? 0;
  if (startingBalanceCents !== 0) {
    throw new AppError(
      "INTERNAL_ERROR",
      `Un solde client (${(startingBalanceCents / 100).toFixed(2)} €) a réduit le prélèvement. Le prix catalogue ${catalogEur} € doit être débité en entier.`,
      502,
    );
  }

  const paidEur = invoiceCardPaidEur(invoice);
  if (invoice.status === "paid" && !catalogChargeMatchesInvoice(catalogEur, paidEur)) {
    throw new AppError(
      "INTERNAL_ERROR",
      `Montant prélevé (${paidEur} €) différent du prix catalogue ${targetPlan} (${catalogEur} €).`,
      502,
    );
  }
}
