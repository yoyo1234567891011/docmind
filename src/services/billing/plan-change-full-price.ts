import { AppError } from "@/lib/errors";
import { getBillingPlan } from "@/config/billing";
import type { PaidBillingPlanId } from "@/types/billing";
import type Stripe from "stripe";

/**
 * Règle produit (option B) : changement payant → payant = **prorata Stripe**.
 *
 * - `proration_behavior: always_invoice` — lignes de prorata + facture immédiate
 * - `payment_behavior: pending_if_incomplete` — le price Stripe ne bascule
 *   qu’après paiement réussi (carte OK / 3DS). Sinon `pending_update` + ancien plan.
 * - Pas de `billing_cycle_anchor: "now"` — période / ancre conservées.
 *
 * Ne pas utiliser `error_if_incomplete` : il refuse le 3DS (erreur sans URL de confirmation).
 */
export const PLAN_CHANGE_PRORATION_UPDATE = {
  proration_behavior: "always_invoice" as const,
  payment_behavior: "pending_if_incomplete" as const,
};

/** Alias historique — même comportement prorata. */
export const PLAN_CHANGE_FULL_PRICE_UPDATE = PLAN_CHANGE_PRORATION_UPDATE;

export const PLAN_CHANGE_PREVIEW_SUBSCRIPTION_DETAILS = {
  proration_behavior: "always_invoice" as const,
};

export function catalogPlanMonthlyEur(plan: PaidBillingPlanId): number {
  const monthly = getBillingPlan(plan).priceMonthlyEur;
  if (monthly == null) {
    throw new Error(`Prix catalogue manquant pour le plan ${plan}.`);
  }
  return monthly;
}

/** Tolérance centimes (arrondis Stripe) — renouvellements catalogue. */
export function catalogChargeMatchesInvoice(
  catalogEur: number,
  invoiceEur: number,
  toleranceEur = 0.01,
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
 * @deprecated Réservé aux tests / renouvellements catalogue.
 * Ne plus utiliser pour les changements de plan (prorata).
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
      "Réinitialisation solde client (legacy full-price — ne plus appeler en prorata)",
  });

  return {
    clearedCreditEur: balanceCents < 0 ? Math.abs(balanceCents) / 100 : 0,
    clearedDebitEur: balanceCents > 0 ? balanceCents / 100 : 0,
  };
}

/**
 * Sanity check prorata : pas de ligne d’ajustement DocMind.
 * Ne compare PAS au prix catalogue plein.
 */
export function assertProrationInvoiceSane(
  invoice: Stripe.Invoice,
  targetPlan: PaidBillingPlanId,
): void {
  for (const line of invoice.lines?.data ?? []) {
    if (line.metadata?.docmind_renewal_offset === "true") {
      throw new AppError(
        "INTERNAL_ERROR",
        `Ligne d'ajustement DocMind interdite sur une facture de changement de plan (${targetPlan}).`,
        502,
      );
    }
  }
}

/**
 * Gate apply local : facture réglée (paid) ou rien à prélever (amount_due ≤ 0).
 * Une facture `open` avec montant dû > 0 ne doit JAMAIS activer le nouveau plan.
 */
export function assertProrationInvoiceSettled(
  invoice: Stripe.Invoice,
  targetPlan: PaidBillingPlanId,
): void {
  assertProrationInvoiceSane(invoice, targetPlan);

  const due = invoice.amount_due ?? 0;
  const status = invoice.status;
  if (status === "paid" || due <= 0) return;

  throw new AppError(
    "BAD_REQUEST",
    `Le paiement du prorata n’est pas confirmé (facture ${status ?? "inconnue"}). Votre plan actuel n’a pas été modifié.`,
    402,
  );
}

/**
 * @deprecated Ne plus utiliser pour les changements de plan (casse le prorata).
 * Conservé pour tests / renouvellements catalogue.
 */
export function assertFullCatalogInvoiceCharged(
  invoice: Stripe.Invoice,
  catalogEur: number,
  targetPlan: PaidBillingPlanId,
): void {
  for (const line of invoice.lines?.data ?? []) {
    if (line.metadata?.docmind_renewal_offset === "true") {
      throw new AppError(
        "INTERNAL_ERROR",
        `Ligne d'ajustement DocMind interdite sur une facture de changement de plan.`,
        502,
      );
    }
  }

  const grossEur = invoiceGrossEur(invoice);
  if (!catalogChargeMatchesInvoice(catalogEur, grossEur)) {
    throw new AppError(
      "INTERNAL_ERROR",
      `Total facture (${grossEur} €) différent du prix catalogue ${targetPlan} (${catalogEur} €).`,
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
  const dueEur = (invoice.amount_due ?? 0) / 100;
  const chargedEur = paidEur > 0 ? paidEur : dueEur;
  if (!catalogChargeMatchesInvoice(catalogEur, chargedEur)) {
    throw new AppError(
      "INTERNAL_ERROR",
      `Montant prélevé (${chargedEur} €) différent du prix catalogue ${targetPlan} (${catalogEur} €).`,
      502,
    );
  }
}
