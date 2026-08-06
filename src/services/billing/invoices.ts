import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { getUserSubscription } from "@/services/billing/store";
import type { BillingInvoiceSummary } from "@/types/billing";

function toIso(unix: number | null | undefined): string | null {
  if (!unix) return null;
  return new Date(unix * 1000).toISOString();
}

export async function listUserInvoices(
  userId: string,
  limit = 12,
): Promise<BillingInvoiceSummary[]> {
  if (!isStripeConfigured()) return [];

  const sub = await getUserSubscription(userId);
  if (!sub.stripeCustomerId) return [];

  const stripe = getStripe();
  const invoices = await stripe.invoices.list({
    customer: sub.stripeCustomerId,
    limit: Math.min(limit, 24),
  });

  return invoices.data.map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    amountDue: (invoice.amount_due ?? 0) / 100,
    amountPaid: (invoice.amount_paid ?? 0) / 100,
    currency: (invoice.currency || "eur").toUpperCase(),
    createdAt: toIso(invoice.created) || new Date().toISOString(),
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdf: invoice.invoice_pdf ?? null,
    periodStart: toIso(invoice.period_start),
    periodEnd: toIso(invoice.period_end),
  }));
}
