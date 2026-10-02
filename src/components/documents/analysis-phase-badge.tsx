import { cn } from "@/lib/utils";
import type { HistoryListItem } from "@/types";

type AnalysisPhase = HistoryListItem["analysisPhase"];

export function AnalysisPhaseBadge({
  phase,
  className,
}: {
  phase?: AnalysisPhase;
  className?: string;
}) {
  if (phase === "preview") {
    return (
      <span
        className={cn(
          "ui-badge border-[color-mix(in_oklab,var(--accent)_22%,transparent)] bg-[var(--accent-soft)] text-[var(--accent)]",
          className,
        )}
      >
        Analyse en cours
      </span>
    );
  }
  if (phase === "failed") {
    return (
      <span
        className={cn(
          "ui-badge border-[color-mix(in_oklab,var(--danger)_22%,transparent)] bg-[var(--danger-soft)] text-[var(--danger)]",
          className,
        )}
      >
        Analyse incomplète
      </span>
    );
  }
  return null;
}
