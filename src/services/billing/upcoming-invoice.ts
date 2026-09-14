import {
  getBillingPlan,
  isPaidBillingPlanId,
  planIdFromStripePriceId,
} from "@/config/billing";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import {
  periodFromSubscription,
  readSubscriptionPriceId,
} from "@/services/billing/apply-subscription";
import {
  catalogChargeMatchesInvoice,
} from "@/services/billing/plan-change-full-price";
import {
  resolveCatalogRenewalAmountDue,
} from "@/services/billing/renewal-catalog";
import { getUserSubscription } from "@/services/billing/store";
import type {
  BillingOpenInvoiceSummary,
  BillingUpcomingInvoice,
} from "@/types/billing";
import type Stripe from "stripe";

function toIso(unix: number | null | undefined): string | null {
  if (!unix) return null;
  return new Date(unix * 1000).toISOString();
}

function centsToUnits(cents: number | null | undefined): number {
  return (cents ?? 0) / 100;
}

const INTERVAL_LABEL = "mensuel";

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

function baseFields(partial: {
  catalogMonthlyEur?: number | null;
  planName?: string | null;
  openInvoice?: BillingOpenInvoiceSummary | null;
}): Pick<
  BillingUpcomingInvoice,
  | "catalogMonthlyEur"
  | "planName"
  | "intervalLabel"
  | "openInvoice"
> {
  return {
    catalogMonthlyEur: partial.catalogMonthlyEur ?? null,
    planName: partial.planName ?? null,
    intervalLabel: INTERVAL_LABEL,
    openInvoice: partial.openInvoice ?? null,
  };
}

function unavailable(
  note: string,
  extras?: {
    catalogMonthlyEur?: number | null;
    planName?: string | null;
    billingDate?: string | null;
    openInvoice?: BillingOpenInvoiceSummary | null;
  },
): BillingUpcomingInvoice {
  return {
    status: "unavailable",
    billingDate: extras?.billingDate ?? null,
    amountDue: null,
    currency: "EUR",
    isEstimate: false,
    hasProration: false,
    prorationAmount: null,
    recurringAmount: null,
    note,
    ...baseFields(extras ?? {}),
  };
}

function noneExpected(
  note: string,
  billingDate?: string | null,
  extras?: {
    catalogMonthlyEur?: number | null;
    planName?: string | null;
    openInvoice?: BillingOpenInvoiceSummary | null;
  },
): BillingUpcomingInvoice {
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
    ...baseFields(extras ?? {}),
  };
}

function toOpenSummary(invoice: Stripe.Invoice): BillingOpenInvoiceSummary {
  return {
    id: invoice.id,
    amountDue: centsToUnits(invoice.amount_due),
    currency: (invoice.currency || "eur").toUpperCase(),
    status: invoice.status ?? "open",
    dueDate: toIso(invoice.due_date) ?? toIso(invoice.created),
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
  };
}

function fromStripeUpcoming(
  invoice: Stripe.Invoice,
  catalogMonthlyEur: number | null,
  periodEnd: string | null,
  planName: string | null,
  openInvoice: BillingOpenInvoiceSummary | null,
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

  const displayRecurring =
    catalogMonthlyEur != null &&
    catalogChargeMatchesInvoice(catalogMonthlyEur, amountDue)
      ? catalogMonthlyEur
      : recurringAmount > 0
        ? recurringAmount
        : null;

  return {
    status: "available",
    // Toujours la fin de période abo — jamais period_end de la preview prorata.
    billingDate: periodEnd,
    amountDue,
    currency: (invoice.currency || "eur").toUpperCase(),
    isEstimate: true,
    hasProration: hasProration || hasResidualCredit,
    prorationAmount: hasProration ? prorationAmount : null,
    recurringAmount: displayRecurring,
    note: hasResidualCredit
      ? `Montant catalogue ${catalogMonthlyEur!.toFixed(2).replace(".", ",")} € / mois (crédits prorata Stripe exclus de l’estimation).`
      : null,
    ...baseFields({ catalogMonthlyEur, planName, openInvoice }),
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

async function findOpenInvoice(
  stripe: ReturnType<typeof getStripe>,
  customerId: string,
): Promise<Stripe.Invoice | null> {
  const open = await stripe.invoices.list({
    customer: customerId,
    status: "open",
    limit: 5,
  });
  return (
    open.data.find((inv) => (inv.amount_due ?? 0) > 0) ?? open.data[0] ?? null
  );
}

/**
 * Prochaine facture Stripe (estimation) + éventuelle facture ouverte.
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

  if (!isPaidBillingPlanId(sub.plan) && sub.status !== "past_due") {
    return unavailable("Offre gratuite — pas de facturation récurrente.");
  }

  const stripe = getStripe();

  let periodEnd = sub.currentPeriodEnd;
  let billablePlanId = isPaidBillingPlanId(sub.plan) ? sub.plan : null;

  try {
    const stripeSub = await stripe.subscriptions.retrieve(
      sub.stripeSubscriptionId,
      { expand: ["items.data.price"] },
    );
    const fromStripe = periodFromSubscription(stripeSub).end;
    if (fromStripe) periodEnd = fromStripe;
    const pricePlan = planIdFromStripePriceId(readSubscriptionPriceId(stripeSub));
    if (isPaidBillingPlanId(pricePlan)) {
      billablePlanId = pricePlan;
    }
  } catch {
    // garde l’état local
  }

  const catalogMonthlyEur = billablePlanId
    ? (getBillingPlan(billablePlanId).priceMonthlyEur ?? null)
    : null;
  const planName = billablePlanId ? getBillingPlan(billablePlanId).name : null;
  const planExtras = { catalogMonthlyEur, planName };

  if (sub.cancelAtPeriodEnd) {
    return noneExpected(
      "Renouvellement annulé — aucun nouveau prélèvement prévu.",
      periodEnd,
      planExtras,
    );
  }

  if (sub.status === "canceled" || sub.status === "unpaid") {
    return noneExpected(
      sub.status === "unpaid"
        ? "Abonnement impayé — régularisez via le portail Stripe."
        : "Abonnement annulé.",
      periodEnd,
      planExtras,
    );
  }

  let openInvoice: BillingOpenInvoiceSummary | null = null;
  try {
    const open = await findOpenInvoice(stripe, sub.stripeCustomerId);
    if (open) openInvoice = toOpenSummary(open);
  } catch {
    // ignore
  }

  if (sub.status === "past_due") {
    if (openInvoice) {
      return {
        status: "open",
        billingDate: openInvoice.dueDate,
        amountDue: openInvoice.amountDue,
        currency: openInvoice.currency,
        isEstimate: false,
        hasProration: false,
        prorationAmount: null,
        recurringAmount: null,
        note: "Paiement en retard — régularisez cette facture. Aucun prochain renouvellement « OK » tant que le solde n’est pas payé.",
        ...baseFields({
          catalogMonthlyEur,
          planName,
          openInvoice,
        }),
      };
    }
    return unavailable(
      "Paiement en retard — montant exact indisponible. Ouvrez le portail Stripe pour régulariser.",
      { ...planExtras, billingDate: periodEnd },
    );
  }

  try {
    const upcoming = await stripe.invoices.createPreview({
      customer: sub.stripeCustomerId,
      subscription: sub.stripeSubscriptionId,
    });

    return fromStripeUpcoming(
      upcoming,
      catalogMonthlyEur,
      periodEnd,
      planName,
      openInvoice && openInvoice.amountDue > 0 ? openInvoice : null,
    );
  } catch (error) {
    if (isNoUpcomingInvoiceError(error)) {
      return noneExpected(
        "Aucune facture à venir pour cet abonnement.",
        periodEnd,
        {
          ...planExtras,
          openInvoice: openInvoice && openInvoice.amountDue > 0 ? openInvoice : null,
        },
      );
    }
    // Date connue même si montant Stripe KO — pas de faux chiffre.
    return unavailable(
      "Montant estimé indisponible pour le moment — consultez le portail Stripe.",
      {
        ...planExtras,
        billingDate: periodEnd,
        openInvoice: openInvoice && openInvoice.amountDue > 0 ? openInvoice : null,
      },
    );
  }
}
