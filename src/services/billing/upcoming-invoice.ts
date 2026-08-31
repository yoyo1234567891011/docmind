import { getBillingPlan, isPaidBillingPlanId } from "@/config/billing";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import {
  catalogChargeMatchesInvoice,
} from "@/services/billing/plan-change-full-price";
import {
  resolveCatalogRenewalAmountDue,
} from "@/services/billing/renewal-catalog";
import { getUserSubscription } from "@/services/billing/store";
import type { BillingUpcomingInvoice } from "@/types/billing";
import type Stripe from "stripe";

function toIso(unix: number | null | undefined): string | null {
  if (!unix) return null;
  return new Date(unix * 1000).toISOString();
}

function centsToUnits(cents: number | null | undefined): number {
  return (cents ?? 0) / 100;
}

export function summarizeInvoiceLines(
  lines: Array<{ amount?: number | null; proration?: boolean | null }>,
): { hasProration: boolean; prorationAmount: number; recurringAmount: number } {
  let prorationAmount = 0;
  let recurringAmount = 0;
  let hasProration = false;

  for (const line of lines) {
    const amount = centsToUnits(line.amount);
    if (line.proration || amount < 0) {
      hasProration = true;
      if (amount < 0) prorationAmount += amount;
    } else {
      recurringAmount += amount;
    }
  }

  return { hasProration, prorationAmount, recurringAmount };
}

function unavailable(note: string): BillingUpcomingInvoice {
  return {
    status: "unavailable",
    billingDate: null,
    amountDue: null,
    currency: "EUR",
    isEstimate: false,
    hasProration: false,
    prorationAmount: null,
    recurringAmount: null,
    note,
  };
}

function noneExpected(note: string, billingDate?: string | null): BillingUpcomingInvoice {
  return {
    status: "none_expected",
    billingDate: billingDate ?? null,
    amountDue: null,
    currency: "EUR",
    isEstimate: false,
    hasProration: false,
    prorationAmount: null,
    recurringAmount: null,
    note,
  };
}

function fromStripeUpcoming(
  invoice: Stripe.Invoice,
  catalogMonthlyEur: number | null,
): BillingUpcomingInvoice {
  const lines = invoice.lines?.data ?? [];
  const { hasProration, prorationAmount, recurringAmount } =
    summarizeInvoiceLines(lines);

  const stripeNetEur = centsToUnits(invoice.amount_due);
  const amountDue = resolveCatalogRenewalAmountDue(invoice, catalogMonthlyEur);
  const hasResidualCredit =
    catalogMonthlyEur != null &&
    !catalogChargeMatchesInvoice(catalogMonthlyEur, stripeNetEur) &&
    catalogChargeMatchesInvoice(catalogMonthlyEur, recurringAmount);

  const billingDate =
    toIso(invoice.next_payment_attempt) ??
    toIso(invoice.period_end) ??
    null;

  const displayRecurring =
    catalogMonthlyEur != null &&
    catalogChargeMatchesInvoice(catalogMonthlyEur, amountDue)
      ? catalogMonthlyEur
      : recurringAmount > 0
        ? recurringAmount
        : null;

  return {
    status: "available",
    billingDate,
    amountDue,
    currency: (invoice.currency || "eur").toUpperCase(),
    isEstimate: true,
    hasProration: hasProration || hasResidualCredit,
    prorationAmount: hasProration ? prorationAmount : null,
    recurringAmount: displayRecurring,
    note: hasResidualCredit
      ? `Prix catalogue ${catalogMonthlyEur!.toFixed(2).replace(".", ",")} € / mois (renouvellement).`
      : null,
  };
}

function fromOpenInvoice(invoice: Stripe.Invoice): BillingUpcomingInvoice {
  return {
    status: "open",
    billingDate: toIso(invoice.due_date) ?? toIso(invoice.created),
    amountDue: centsToUnits(invoice.amount_due),
    currency: (invoice.currency || "eur").toUpperCase(),
    isEstimate: false,
    hasProration: false,
    prorationAmount: null,
    recurringAmount: null,
    note: "Facture ouverte en attente de paiement.",
  };
}

function isNoUpcomingInvoiceError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const stripeError = error as { code?: string; message?: string };
  const code = stripeError.code ?? "";
  const message = (stripeError.message ?? "").toLowerCase();
  return (
    code === "invoice_upcoming_none" ||
    message.includes("no upcoming invoices") ||
    message.includes("does not have an upcoming invoice")
  );
}

/**
 * Prochaine facture Stripe (estimation) ou facture ouverte si impayé.
 * Ne lève pas : renvoie `unavailable` si Stripe indisponible ou données manquantes.
 */
export async function getUserUpcomingInvoice(
  userId: string,
): Promise<BillingUpcomingInvoice> {
  if (!isStripeConfigured()) {
    return unavailable("Stripe non configuré.");
  }

  const sub = await getUserSubscription(userId);
  if (!sub.stripeCustomerId || !sub.stripeSubscriptionId) {
    return unavailable("Aucun abonnement Stripe actif.");
  }

  if (!isPaidBillingPlanId(sub.plan)) {
    return unavailable("Offre gratuite — pas de facturation récurrente.");
  }

  if (sub.cancelAtPeriodEnd) {
    return noneExpected(
      "Renouvellement annulé — aucun nouveau prélèvement prévu.",
      sub.currentPeriodEnd,
    );
  }

  if (sub.status === "canceled" || sub.status === "unpaid") {
    return noneExpected(
      sub.status === "unpaid"
        ? "Abonnement impayé — régularisez via le portail Stripe."
        : "Abonnement annulé.",
      sub.currentPeriodEnd,
    );
  }

  const stripe = getStripe();

  if (sub.status === "past_due") {
    try {
      const open = await stripe.invoices.list({
        customer: sub.stripeCustomerId,
        status: "open",
        limit: 1,
      });
      const invoice = open.data[0];
      if (invoice) return fromOpenInvoice(invoice);
    } catch {
      // fallback sur upcoming ci-dessous
    }
  }

  try {
    const catalogMonthlyEur = isPaidBillingPlanId(sub.plan)
      ? (getBillingPlan(sub.plan).priceMonthlyEur ?? null)
      : null;

    const upcoming = await stripe.invoices.createPreview({
      customer: sub.stripeCustomerId,
      subscription: sub.stripeSubscriptionId,
    });

    return fromStripeUpcoming(upcoming, catalogMonthlyEur);
  } catch (error) {
    if (isNoUpcomingInvoiceError(error)) {
      return noneExpected(
        "Aucune facture à venir pour cet abonnement.",
        sub.currentPeriodEnd,
      );
    }
    return unavailable(
      "Estimation indisponible pour le moment — consultez le portail Stripe.",
    );
  }
}
