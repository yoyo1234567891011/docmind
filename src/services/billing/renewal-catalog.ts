import type Stripe from "stripe";

import { catalogChargeMatchesInvoice } from "@/services/billing/plan-change-full-price";

const RENEWAL_OFFSET_META = "docmind_renewal_offset";

function centsToEur(cents: number): number {
  return cents / 100;
}

/** Somme des lignes positives (ex. « 1 × Extra »). */
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
 * récurrente Stripe correspond, sinon le net Stripe.
 */
export function resolveCatalogRenewalAmountDue(
  invoice: Stripe.Invoice,
  catalogMonthlyEur: number | null,
): number {
  const netEur = centsToEur(invoice.amount_due ?? 0);
  if (catalogMonthlyEur == null) return netEur;

  const recurringEur = recurringLineTotalEur(invoice.lines?.data ?? []);
  if (catalogChargeMatchesInvoice(catalogMonthlyEur, recurringEur)) {
    return catalogMonthlyEur;
  }
  return netEur;
}

/**
 * Compense les crédits prorata résiduels dans la preview de renouvellement
 * (ex. −1,06 € « temps non utilisé » → net 58,93 € au lieu de 59,99 €).
 */
export async function reconcileRenewalPreviewToCatalog(
  stripe: Stripe,
  input: {
    customerId: string;
    subscriptionId: string;
    catalogMonthlyEur: number;
  },
): Promise<{ offsetAddedEur: number; netBeforeEur: number; netAfterEur: number }> {
  const preview = await stripe.invoices.createPreview({
    customer: input.customerId,
    subscription: input.subscriptionId,
  });

  const catalogCents = Math.round(input.catalogMonthlyEur * 100);
  const netBeforeCents = preview.amount_due ?? 0;
  const netBeforeEur = centsToEur(netBeforeCents);

  if (catalogChargeMatchesInvoice(input.catalogMonthlyEur, netBeforeEur)) {
    return { offsetAddedEur: 0, netBeforeEur, netAfterEur: netBeforeEur };
  }

  const recurringEur = recurringLineTotalEur(preview.lines?.data ?? []);
  if (!catalogChargeMatchesInvoice(input.catalogMonthlyEur, recurringEur)) {
    return { offsetAddedEur: 0, netBeforeEur, netAfterEur: netBeforeEur };
  }

  const deltaCents = catalogCents - netBeforeCents;
  if (deltaCents <= 0) {
    return { offsetAddedEur: 0, netBeforeEur, netAfterEur: netBeforeEur };
  }

  const pending = await stripe.invoiceItems.list({
    customer: input.customerId,
    pending: true,
  });
  for (const item of pending.data) {
    if (item.metadata?.[RENEWAL_OFFSET_META] === "true") {
      await stripe.invoiceItems.del(item.id);
    }
  }

  await stripe.invoiceItems.create({
    customer: input.customerId,
    amount: deltaCents,
    currency: (preview.currency || "eur").toLowerCase(),
    description: "Ajustement renouvellement — prix catalogue DocMind",
    metadata: { [RENEWAL_OFFSET_META]: "true" },
  });

  const after = await stripe.invoices.createPreview({
    customer: input.customerId,
    subscription: input.subscriptionId,
  });

  return {
    offsetAddedEur: centsToEur(deltaCents),
    netBeforeEur,
    netAfterEur: centsToEur(after.amount_due ?? 0),
  };
}
