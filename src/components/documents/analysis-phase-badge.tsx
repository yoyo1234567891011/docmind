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
          "rounded-md bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]",
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
          "rounded-md bg-[var(--danger-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--danger)]",
          className,
        )}
      >
        Analyse incomplète
      </span>
    );
  }
  return null;
}
