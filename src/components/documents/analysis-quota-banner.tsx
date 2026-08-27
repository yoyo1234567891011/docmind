"use client";

import Link from "next/link";

import { BILLING_PLANS } from "@/config/billing";
import type { QuotaStatus } from "@/lib/client/quotas";
import { formatAnalyzeQuotaRemaining } from "@/lib/quotas/display";
import { cn } from "@/lib/utils";
import type { BillingPlanId } from "@/types/billing";

type AnalysisQuotaBannerProps = {
  quotas: QuotaStatus;
  className?: string;
};

function planLabel(plan: string): string {
  const id = plan as BillingPlanId;
  return BILLING_PLANS[id]?.name ?? plan;
}

export function AnalysisQuotaBanner({
  quotas,
  className,
}: AnalysisQuotaBannerProps) {
  const analyze = quotas.items.find((i) => i.metric === "analyze");
  if (!analyze || analyze.unlimited) return null;

  const exhausted = analyze.remaining <= 0;
  const line = formatAnalyzeQuotaRemaining(analyze);
  const canUpgrade = quotas.plan !== "extra";

  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        exhausted
          ? "border-[var(--warning)]/40 bg-[var(--warning)]/10"
          : "border-[var(--border)] bg-[var(--surface)]",
        className,
      )}
    >
      <p className={exhausted ? "text-[var(--warning)]" : "text-[var(--foreground)]"}>
        {exhausted
          ? quotas.plan === "free"
            ? `Vous avez utilisé vos ${analyze.limit} analyses du mois.`
            : `Quota ${planLabel(quotas.plan)} atteint pour ce mois.`
          : line}
      </p>
      {exhausted && canUpgrade ? (
        <Link
          href="/facturation"
          className="mt-2 inline-block font-medium text-[var(--accent)] underline-offset-2 hover:underline"
        >
          {quotas.plan === "free"
            ? "Choisir un plan pour continuer"
            : "Passer à une offre supérieure"}
        </Link>
      ) : null}
      {!exhausted ? (
        <p className="mt-1 text-xs text-[var(--muted)]">
          Plan {planLabel(quotas.plan)} · {analyze.used}/{analyze.limit}{" "}
          utilisées
        </p>
      ) : null}
    </div>
  );
}
