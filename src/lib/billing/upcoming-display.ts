import { formatDateTime, formatMoneyEur } from "@/lib/format";
import type {
  BillingImmediateInvoice,
  BillingPlanChangePreview,
  BillingPlanDefinition,
  BillingUpcomingInvoice,
  UserSubscriptionRecord,
} from "@/types/billing";

export function resolveNextBillingDate(
  upcoming: BillingUpcomingInvoice,
  subscription: UserSubscriptionRecord,
): string | null {
  // Renouvellement = fin de période abonnement Stripe (pas period_end facture prorata).
  if (upcoming.status === "open") {
    return (
      upcoming.openInvoice?.dueDate ??
      upcoming.billingDate ??
      subscription.currentPeriodEnd ??
      null
    );
  }
  return (
    subscription.currentPeriodEnd ??
    upcoming.billingDate ??
    null
  );
}

export type UpcomingChargesRow = {
  label: string;
  value: string;
};

export type UpcomingChargesView = {
  title: string;
  rows: UpcomingChargesRow[];
  footnotes: string[];
  showPortalHint: boolean;
  tone: "normal" | "warning";
};

function planLabel(
  upcoming: BillingUpcomingInvoice,
  plan: BillingPlanDefinition,
): string {
  const name = upcoming.planName ?? plan.name;
  const monthly =
    upcoming.catalogMonthlyEur ?? plan.priceMonthlyEur ?? null;
  const interval = upcoming.intervalLabel ?? "mensuel";
  if (monthly != null) {
    return `${name} — ${formatMoneyEur(monthly)} / mois (${interval})`;
  }
  return name;
}

/**
 * Vue structurée « Prochains prélèvements » pour /facturation.
 */
export function describeUpcomingInvoice(
  upcoming: BillingUpcomingInvoice,
  plan: BillingPlanDefinition,
  subscription: UserSubscriptionRecord,
): UpcomingChargesView {
  const renewalDate = resolveNextBillingDate(upcoming, subscription);
  const open = upcoming.openInvoice;

  if (upcoming.status === "open" || subscription.status === "past_due") {
    const rows: UpcomingChargesRow[] = [];
    if (upcoming.planName || plan.priceMonthlyEur != null) {
      rows.push({ label: "Plan catalogue", value: planLabel(upcoming, plan) });
    }
    if (open || upcoming.amountDue != null) {
      rows.push({
        label: "Facture à payer",
        value: formatMoneyEur(open?.amountDue ?? upcoming.amountDue ?? 0),
      });
      rows.push({
        label: "Statut",
        value: "À payer — accès payant suspendu jusqu’à régularisation",
      });
      const due = open?.dueDate ?? upcoming.billingDate;
      if (due) {
        rows.push({ label: "Échéance", value: formatDateTime(due) });
      }
    }
    if (subscription.currentPeriodEnd) {
      rows.push({
        label: "Fin de période (référence)",
        value: formatDateTime(subscription.currentPeriodEnd),
      });
    }
    return {
      title: "Prochains prélèvements",
      rows,
      footnotes: [
        upcoming.note ??
          "Régularisez via le portail Stripe. Aucun prochain renouvellement n’est promis tant que cette facture n’est pas payée.",
      ],
      showPortalHint: true,
      tone: "warning",
    };
  }

  if (subscription.cancelAtPeriodEnd) {
    return {
      title: "Prochains prélèvements",
      rows: [
        { label: "Plan", value: planLabel(upcoming, plan) },
        {
          label: "Prochain prélèvement",
          value: "Aucun — renouvellement annulé",
        },
        ...(renewalDate
          ? [
              {
                label: "Accès jusqu’au",
                value: formatDateTime(renewalDate),
              },
            ]
          : []),
      ],
      footnotes: [],
      showPortalHint: false,
      tone: "normal",
    };
  }

  if (upcoming.status === "none_expected") {
    return {
      title: "Prochains prélèvements",
      rows: [
        ...(upcoming.planName
          ? [{ label: "Plan", value: planLabel(upcoming, plan) }]
          : []),
        {
          label: "Prochain prélèvement",
          value: "Aucun prévu",
        },
        ...(renewalDate
          ? [{ label: "Date de référence", value: formatDateTime(renewalDate) }]
          : []),
      ],
      footnotes: [upcoming.note].filter((n): n is string => Boolean(n)),
      showPortalHint: false,
      tone: "normal",
    };
  }

  const rows: UpcomingChargesRow[] = [
    { label: "Plan", value: planLabel(upcoming, plan) },
  ];

  if (renewalDate) {
    rows.push({
      label: "Date du prochain prélèvement",
      value: formatDateTime(renewalDate),
    });
  } else {
    rows.push({
      label: "Date du prochain prélèvement",
      value: "Indisponible",
    });
  }

  if (upcoming.status === "unavailable") {
    rows.push({
      label: "Montant estimé",
      value: "Indisponible — consultez Stripe",
    });
  } else if (upcoming.amountDue != null) {
    rows.push({
      label: upcoming.isEstimate
        ? "Montant estimé (renouvellement)"
        : "Montant du renouvellement",
      value: formatMoneyEur(upcoming.amountDue),
    });
  } else if (upcoming.catalogMonthlyEur != null) {
    rows.push({
      label: "Montant catalogue",
      value: `${formatMoneyEur(upcoming.catalogMonthlyEur)} / mois`,
    });
    rows.push({
      label: "Montant estimé Stripe",
      value: "Indisponible pour le moment",
    });
  } else {
    rows.push({
      label: "Montant estimé",
      value: "Indisponible — consultez Stripe",
    });
  }

  if (open && open.amountDue > 0) {
    rows.push({
      label: "Facture ouverte (prorata / en attente)",
      value: `${formatMoneyEur(open.amountDue)} — ${
        open.status === "paid" ? "payée" : "à payer"
      }`,
    });
  }

  const footnotes: string[] = [];
  if (upcoming.note) footnotes.push(upcoming.note);
  if (isPremiumRecurring(subscription) && upcoming.status === "available") {
    footnotes.push(
      "Un changement de plan ajuste le montant au prorata de la période restante (calcul Stripe).",
    );
  }

  return {
    title: "Prochains prélèvements",
    rows,
    footnotes,
    showPortalHint:
      upcoming.status === "unavailable" || upcoming.amountDue == null,
    tone: open && open.amountDue > 0 ? "warning" : "normal",
  };
}

function isPremiumRecurring(subscription: UserSubscriptionRecord): boolean {
  return (
    subscription.status === "active" ||
    subscription.status === "trialing" ||
    subscription.status === "past_due"
  );
}

export function describePlanChangePreview(
  preview: BillingPlanChangePreview,
): string[] {
  const lines: string[] = [
    `Plan actuel : ${preview.currentPlanName}${
      preview.currentMonthlyEur != null
        ? ` (${formatMoneyEur(preview.currentMonthlyEur)} / mois)`
        : ""
    }.`,
    `Nouveau plan : ${preview.targetPlanName}${
      preview.targetMonthlyEur != null
        ? ` (${formatMoneyEur(preview.targetMonthlyEur)} / mois)`
        : ""
    }.`,
  ];

  if (preview.deferredToPeriodEnd) {
    if (preview.nextBillingDate) {
      lines.push(
        `Passage à ${preview.targetPlanName} le ${formatDateTime(preview.nextBillingDate)}. Jusqu’à cette date vous restez sur ${preview.currentPlanName}.`,
      );
    } else {
      lines.push(
        `Passage à ${preview.targetPlanName} en fin de période. Jusqu’à cette date vous restez sur ${preview.currentPlanName}.`,
      );
    }
    lines.push(
      "Aucun prélèvement immédiat attendu (montant souvent 0 €) — le plan bas ne s’applique pas tout de suite.",
    );
    if (preview.nextMonthlyEur != null) {
      lines.push(
        `Ensuite : ${formatMoneyEur(preview.nextMonthlyEur)} / mois.`,
      );
    }
    return lines;
  }

  lines.push(
    "Le montant sera ajusté au prorata de la période restante (calcul Stripe).",
  );

  if (preview.immediateAmountDue != null && preview.immediateAmountDue > 0) {
    lines.push(
      `Estimation du prélèvement immédiat : ${formatMoneyEur(preview.immediateAmountDue)} (prorata).`,
    );
  } else if (preview.immediateAmountDue === 0) {
    lines.push(
      "Aucun prélèvement immédiat estimé (vérifiez la facture Stripe après confirmation).",
    );
  } else {
    lines.push(
      preview.note ??
        "Le montant exact apparaît sur la facture Stripe après confirmation.",
    );
  }

  if (preview.nextBillingDate && preview.nextMonthlyEur != null) {
    lines.push(
      `Prochain renouvellement (fin de période actuelle) : ${formatDateTime(preview.nextBillingDate)} — puis ${formatMoneyEur(preview.nextMonthlyEur)} / mois.`,
    );
  } else if (preview.nextMonthlyEur != null) {
    lines.push(
      `Ensuite, renouvellement à ${formatMoneyEur(preview.nextMonthlyEur)} / mois (même cycle de facturation).`,
    );
  }

  lines.push(
    "La confirmation et le paiement (carte / 3DS) se font sur une page Stripe — pas de prélèvement silencieux dans DocMind.",
  );
  lines.push(
    "Si vous refusez ou abandonnez la page Stripe, votre plan actuel reste inchangé.",
  );

  return lines;
}

export function describePlanChangeMessage(input: {
  planName: string;
  targetMonthlyEur: number | null;
  immediateInvoice: BillingImmediateInvoice | null;
  upcoming: BillingUpcomingInvoice;
  subscription: UserSubscriptionRecord;
}): string {
  const billingDate =
    input.subscription.currentPeriodEnd ??
    resolveNextBillingDate(input.upcoming, input.subscription);
  const parts = [`Passage à ${input.planName} confirmé.`];

  if (input.immediateInvoice) {
    const charged =
      input.immediateInvoice.amountPaid > 0
        ? input.immediateInvoice.amountPaid
        : input.immediateInvoice.amountDue;
    if (charged > 0) {
      parts.push(
        `${formatMoneyEur(charged)} prélevés (prorata) — facture ${input.immediateInvoice.number ?? input.immediateInvoice.id}.`,
      );
    } else {
      parts.push(
        "Aucun prélèvement immédiat (crédit / solde Stripe éventuel).",
      );
    }
  } else if (input.targetMonthlyEur != null) {
    parts.push(
      "Consultez le portail Stripe pour le détail du prorata.",
    );
  }

  if (billingDate && input.targetMonthlyEur != null) {
    parts.push(
      `Prochain prélèvement : ${formatDateTime(billingDate)} — ${formatMoneyEur(input.targetMonthlyEur)} / mois.`,
    );
  } else if (billingDate) {
    parts.push(`Prochain prélèvement : ${formatDateTime(billingDate)}.`);
  }

  return parts.join(" ");
}

export const PLAN_CHANGE_HINT =
  "Changement de plan : montant ajusté au prorata de la période restante (calcul Stripe).";
