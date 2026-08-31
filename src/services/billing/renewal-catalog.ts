import type Stripe from "stripe";

import {
  getBillingPlan,
  isPaidBillingPlanId,
  planIdFromStripePriceId,
} from "@/config/billing";
import { catalogChargeMatchesInvoice } from "@/services/billing/plan-change-full-price";

export const DOCMIND_RENEWAL_OFFSET_META = "docmind_renewal_offset";

function centsToEur(cents: number): number {
  return cents / 100;
}

/** Somme des lignes positives récurrentes (ex. « 1 × Extra »). */
export function recurringLineTotalEur(
  lines: Stripe.InvoiceLineItem[],
): number {
  let totalCents = 0;
  for (const line of lines) {
    const amount = line.amount ?? 0;
    if (amount > 0) totalCents += amount;
  }
  return centsToEur(totalCents);
}

/**
 * Montant affiché pour le prochain renouvellement : prix catalogue si la ligne
 * récurrente Stripe correspond (ignore les crédits prorata résiduels dans la preview).
 */
export function resolveCatalogRenewalAmountDue(
  invoice: Stripe.Invoice,
  catalogMonthlyEur: number | null,
): number {
  const netEur = centsToEur(invoice.amount_due ?? 0);
  if (catalogMonthlyEur == null) return netEur;

  const recurringEur = recurringLineTotalEur(invoice.lines?.data ?? []);
  if (catalogChargeMatchesInvoice(catalogMonthlyEur, recurringEur, 0.01)) {
    return catalogMonthlyEur;
  }
  return netEur;
}

/**
 * Supprime les lignes en attente DocMind — elles polluent les factures de
 * changement de plan (ex. +1,06 € + 34,99 € = 36,05 €).
 */
export async function clearPendingDocmindAdjustmentItems(
  stripe: Stripe,
  customerId: string,
): Promise<number> {
  const pending = await stripe.invoiceItems.list({
    customer: customerId,
    pending: true,
  });
  let removed = 0;
  for (const item of pending.data) {
    if (item.metadata?.[DOCMIND_RENEWAL_OFFSET_META] === "true") {
      await stripe.invoiceItems.del(item.id);
      removed += 1;
    }
  }
  return removed;
}

/**
 * Sur renouvellement mensuel uniquement (facture brouillon), compense un crédit
 * prorata résiduel en ajoutant une ligne liée à CETTE facture (pas en pending).
 */
export async function offsetDraftRenewalInvoiceToCatalog(
  stripe: Stripe,
  invoice: Stripe.Invoice,
): Promise<boolean> {
  if (invoice.billing_reason !== "subscription_cycle") return false;
  if (invoice.status !== "draft" || !invoice.id) return false;

  const customerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id;
  if (!customerId) return false;

  const lines = invoice.lines?.data ?? [];
  const recurringEur = recurringLineTotalEur(lines);
  const netCents = invoice.amount_due ?? 0;
  const netEur = centsToEur(netCents);

  const priceId = lines.find((l) => (l.amount ?? 0) > 0)?.price;
  const priceIdStr =
    typeof priceId === "string" ? priceId : priceId?.id ?? null;
  const plan = planIdFromStripePriceId(priceIdStr);
  if (!isPaidBillingPlanId(plan)) return false;

  const catalogEur = getBillingPlan(plan).priceMonthlyEur;
  if (catalogEur == null) return false;

  if (catalogChargeMatchesInvoice(catalogEur, netEur, 0.01)) return false;
  if (!catalogChargeMatchesInvoice(catalogEur, recurringEur, 0.01)) return false;

  const deltaCents = Math.round(catalogEur * 100) - netCents;
  if (deltaCents <= 0) return false;

  const alreadyOffset = lines.some(
    (l) => l.metadata?.[DOCMIND_RENEWAL_OFFSET_META] === "true",
  );
  if (alreadyOffset) return false;

  await stripe.invoiceItems.create({
    customer: customerId,
    invoice: invoice.id,
    amount: deltaCents,
    currency: (invoice.currency || "eur").toLowerCase(),
    description: "Ajustement renouvellement — prix catalogue DocMind",
    metadata: { [DOCMIND_RENEWAL_OFFSET_META]: "true" },
  });

  return true;
}
