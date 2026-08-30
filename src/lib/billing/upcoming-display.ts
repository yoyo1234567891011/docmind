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
  return (
    upcoming.billingDate ??
    subscription.currentPeriodEnd ??
    null
  );
}

export function describeUpcomingInvoice(
  upcoming: BillingUpcomingInvoice,
  plan: BillingPlanDefinition,
  subscription: UserSubscriptionRecord,
): {
  title: string;
  lines: string[];
  showPortalHint: boolean;
} {
  const billingDate = resolveNextBillingDate(upcoming, subscription);
  const monthly =
    plan.priceMonthlyEur != null
      ? `${formatMoneyEur(plan.priceMonthlyEur)} / mois`
      : null;

  if (upcoming.status === "open") {
    const lines = [
      "Un paiement est en attente. Régularisez via le portail Stripe pour éviter la suspension.",
    ];
    if (billingDate) {
      lines.unshift(`Échéance : ${formatDateTime(billingDate)}.`);
    }
    if (upcoming.amountDue != null) {
      lines.unshift(`Montant dû : ${formatMoneyEur(upcoming.amountDue)}.`);
    }
    return {
      title: "Paiement en retard",
      lines,
      showPortalHint: true,
    };
  }

  if (subscription.cancelAtPeriodEnd) {
    return {
      title: "Prochaine facturation",
      lines: [
        monthly
          ? `Plan ${plan.name} — ${monthly} (jusqu’à la fin de période).`
          : `Plan ${plan.name} jusqu’à la fin de période.`,
        billingDate
          ? `Accès payant jusqu’au ${formatDateTime(billingDate)} — aucun nouveau prélèvement prévu.`
          : "Renouvellement annulé — aucun nouveau prélèvement prévu.",
      ],
      showPortalHint: false,
    };
  }

  if (upcoming.status === "none_expected") {
    return {
      title: "Prochaine facturation",
      lines: [
        upcoming.note ??
          "Aucune facture récurrente prévue pour cet abonnement.",
        billingDate
          ? `Date de référence : ${formatDateTime(billingDate)}.`
          : null,
      ].filter((line): line is string => Boolean(line)),
      showPortalHint: false,
    };
  }

  if (upcoming.status === "unavailable") {
    return {
      title: "Prochaine facturation",
      lines: [
        monthly
          ? `Plan ${plan.name} — ${monthly}.`
          : `Plan ${plan.name}.`,
        billingDate
          ? `Prochaine échéance estimée le ${formatDateTime(billingDate)}.`
          : "Date de prochaine facturation indisponible.",
        upcoming.note ??
          "Montant exact indisponible pour le moment — consultez le portail Stripe.",
      ],
      showPortalHint: true,
    };
  }

  const lines: string[] = [
    monthly
      ? `Plan ${plan.name} — ${monthly}.`
      : `Plan ${plan.name}.`,
  ];

  if (billingDate) {
    lines.push(
      `Prochain renouvellement estimé le ${formatDateTime(billingDate)}.`,
    );
  }

  if (upcoming.amountDue != null) {
    lines.push(
      upcoming.isEstimate
        ? `Montant estimé du prochain renouvellement : ${formatMoneyEur(upcoming.amountDue)}.`
        : `Montant du prochain renouvellement : ${formatMoneyEur(upcoming.amountDue)}.`,
    );
  }

  if (isPremiumRecurring(subscription)) {
    lines.push(
      "Les changements de plan déclenchent un prélèvement immédiat du prorata ; le renouvellement mensuel suit à la prochaine échéance.",
    );
  }

  return {
    title: "Prochaine facturation",
    lines,
    showPortalHint: upcoming.amountDue == null,
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

  if (preview.immediateAmountDue != null) {
    if (preview.immediateAmountDue > 0) {
      lines.push(
        `Un prélèvement immédiat d’environ ${formatMoneyEur(preview.immediateAmountDue)} (prorata) sera tenté sur votre carte enregistrée.`,
      );
    } else if (preview.isUpgrade) {
      lines.push(
        "Un ajustement au prorata sera facturé immédiatement (montant estimé indisponible).",
      );
    } else {
      lines.push(
        "Aucun prélèvement immédiat attendu (crédit ou ajustement nul) — le nouveau tarif s’applique dès maintenant.",
      );
    }
  } else {
    lines.push(
      preview.note ??
        "Un paiement au prorata peut être prélevé immédiatement lors de la confirmation.",
    );
  }

  if (preview.nextBillingDate && preview.nextMonthlyEur != null) {
    lines.push(
      `Ensuite, ${formatMoneyEur(preview.nextMonthlyEur)} / mois à partir du ${formatDateTime(preview.nextBillingDate)}.`,
    );
  } else if (preview.nextMonthlyEur != null) {
    lines.push(
      `Ensuite, renouvellement à ${formatMoneyEur(preview.nextMonthlyEur)} / mois.`,
    );
  }

  lines.push(
    "Si le paiement immédiat échoue, votre plan actuel reste inchangé.",
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
  const billingDate = resolveNextBillingDate(input.upcoming, input.subscription);
  const parts = [`Plan ${input.planName} activé.`];

  if (input.immediateInvoice) {
    const charged =
      input.immediateInvoice.amountPaid > 0
        ? input.immediateInvoice.amountPaid
        : input.immediateInvoice.amountDue;
    if (charged > 0) {
      parts.push(
        `Un ajustement de ${formatMoneyEur(charged)} vient d’être prélevé (facture ${input.immediateInvoice.number ?? input.immediateInvoice.id}).`,
      );
    } else {
      parts.push(
        "Aucun prélèvement immédiat sur cette facture d’ajustement (crédit ou montant nul).",
      );
    }
    if (input.immediateInvoice.hostedInvoiceUrl) {
      parts.push("Consultez la facture dans le portail Stripe.");
    }
  } else {
    parts.push(
      "Un ajustement au prorata a été facturé immédiatement — consultez le portail Stripe pour le détail.",
    );
  }

  if (billingDate && input.targetMonthlyEur != null) {
    parts.push(
      `Prochain renouvellement : ${formatDateTime(billingDate)} — ${formatMoneyEur(input.targetMonthlyEur)} / mois.`,
    );
  } else if (billingDate) {
    parts.push(`Prochain renouvellement : ${formatDateTime(billingDate)}.`);
  } else if (input.upcoming.status === "available" && input.upcoming.amountDue != null) {
    parts.push(
      `Prochain renouvellement estimé : ${formatMoneyEur(input.upcoming.amountDue)}.`,
    );
  }

  return parts.join(" ");
}

export const PLAN_CHANGE_HINT =
  "Changement immédiat : un prélèvement au prorata peut être effectué maintenant, puis le tarif mensuel à la prochaine échéance.";
