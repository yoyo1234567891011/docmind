"use client";

import Link from "next/link";

import { BILLING_PLANS } from "@/config/billing";
import type { QuotaStatus } from "@/lib/client/quotas";
import {
  formatAnalyzeQuotaRemaining,
  formatUploadQuotaRemaining,
} from "@/lib/quotas/display";
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

/**
 * Bannière analyser : analyses + imports PDF (même getQuotaStatus / plan).
 * L’upload consomme le plafond `upload`, distinct d’`analyze`.
 */
export function AnalysisQuotaBanner({
  quotas,
  className,
}: AnalysisQuotaBannerProps) {
  const analyze = quotas.items.find((i) => i.metric === "analyze");
  const upload = quotas.items.find((i) => i.metric === "upload");
  if ((!analyze || analyze.unlimited) && (!upload || upload.unlimited)) {
    return null;
  }

  const analyzeExhausted = Boolean(analyze && !analyze.unlimited && analyze.remaining <= 0);
  const uploadExhausted = Boolean(upload && !upload.unlimited && upload.remaining <= 0);
  const exhausted = analyzeExhausted || uploadExhausted;
  const canUpgrade = quotas.plan !== "extra";
  const plan = planLabel(quotas.plan);

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
      {analyze && !analyze.unlimited ? (
        <p
          className={
            analyzeExhausted
              ? "text-[var(--warning)]"
              : "text-[var(--foreground)]"
          }
        >
          {analyzeExhausted
            ? quotas.plan === "free"
              ? `Vous avez utilisé vos ${analyze.limit} analyses du mois.`
              : `Quota analyses ${plan} atteint (${analyze.used}/${analyze.limit}).`
            : formatAnalyzeQuotaRemaining(analyze)}
        </p>
      ) : null}
      {analyze && !analyze.unlimited && !analyzeExhausted ? (
        <p className="mt-1 text-xs text-[var(--muted)]">
          Plan {plan} · {analyze.used}/{analyze.limit} analyses
        </p>
      ) : null}

      {upload && !upload.unlimited ? (
        <p
          className={cn(
            analyze && !analyze.unlimited ? "mt-2" : "",
            uploadExhausted
              ? "text-[var(--warning)]"
              : "text-[var(--foreground)]",
          )}
        >
          {uploadExhausted
            ? `Quota d’import PDF ${plan} atteint (${upload.used}/${upload.limit}).`
            : formatUploadQuotaRemaining(upload)}
        </p>
      ) : null}
      {upload && !upload.unlimited && !uploadExhausted ? (
        <p className="mt-1 text-xs text-[var(--muted)]">
          Plan {plan} · {upload.used}/{upload.limit} imports PDF
        </p>
      ) : null}

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
    </div>
  );
}
