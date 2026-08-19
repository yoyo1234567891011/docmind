"use client";

import Link from "next/link";

import type { QuotaStatus } from "@/lib/client/quotas";
import { formatAnalyzeQuotaRemaining } from "@/lib/quotas/display";
import { cn } from "@/lib/utils";

type AnalysisQuotaBannerProps = {
  quotas: QuotaStatus;
  className?: string;
};

export function AnalysisQuotaBanner({
  quotas,
  className,
}: AnalysisQuotaBannerProps) {
  const analyze = quotas.items.find((i) => i.metric === "analyze");
  if (!analyze || analyze.unlimited) return null;

  const exhausted = analyze.remaining <= 0;
  const line = formatAnalyzeQuotaRemaining(analyze);

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
            : "Quota Premium atteint pour ce mois."
          : line}
      </p>
      {exhausted && quotas.plan === "free" ? (
        <Link
          href="/facturation"
          className="mt-2 inline-block font-medium text-[var(--accent)] underline-offset-2 hover:underline"
        >
          Passer Premium pour continuer
        </Link>
      ) : null}
      {!exhausted ? (
        <p className="mt-1 text-xs text-[var(--muted)]">
          Plan {quotas.plan === "premium" ? "Premium" : "Gratuit"} · {analyze.used}/
          {analyze.limit} utilisées
        </p>
      ) : null}
    </div>
  );
}
