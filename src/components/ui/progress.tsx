import { cn } from "@/lib/utils";

interface ProgressBarProps {
  value?: number;
  indeterminate?: boolean;
  className?: string;
  trackClassName?: string;
  barClassName?: string;
  label?: string;
}

export function ProgressBar({
  value = 0,
  indeterminate = false,
  className,
  trackClassName,
  barClassName,
  label,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className={cn("w-full", className)}>
      {label ? (
        <div className="mb-2 flex items-center justify-between gap-3 text-xs text-[var(--muted)]">
          <span>{label}</span>
          {!indeterminate ? (
            <span className="font-mono tabular-nums">{Math.round(clamped)}%</span>
          ) : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
        aria-label={label || "Progression"}
        className={cn(
          "relative h-1.5 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--muted)_15%,transparent)] shadow-[inset_0_1px_1px_color-mix(in_oklab,var(--foreground)_6%,transparent)]",
          trackClassName,
        )}
      >
        {indeterminate ? (
          <div
            className={cn(
              "absolute inset-y-0 w-1/3 rounded-full bg-[linear-gradient(90deg,transparent,var(--accent)_35%,var(--accent)_65%,transparent)] animate-progress-indeterminate",
              barClassName,
            )}
          />
        ) : (
          <div
            className={cn(
              "h-full rounded-full bg-[var(--accent)] shadow-[0_0_10px_color-mix(in_oklab,var(--accent)_45%,transparent)] transition-[width] duration-500 ease-[var(--ease-out)]",
              barClassName,
            )}
            style={{ width: `${clamped}%` }}
          />
        )}
      </div>
    </div>
  );
}

export type AnalysisStepId = "upload" | "extract" | "analyze" | "reply";

interface AnalysisProgressProps {
  currentStep: AnalysisStepId;
  className?: string;
}

const STEPS: Array<{ id: AnalysisStepId; label: string }> = [
  { id: "upload", label: "Envoi" },
  { id: "extract", label: "Extraction" },
  { id: "analyze", label: "Analyse" },
  { id: "reply", label: "Réponse" },
];

function stepIndex(id: AnalysisStepId) {
  return STEPS.findIndex((step) => step.id === id);
}

export function AnalysisProgress({
  currentStep,
  className,
}: AnalysisProgressProps) {
  const activeIndex = stepIndex(currentStep);
  const percent = ((activeIndex + 1) / STEPS.length) * 100;
  const isAnalyzing = currentStep === "analyze";

  return (
    <div
      className={cn(
        "surface-panel animate-fade-up rounded-2xl px-5 py-4",
        className,
      )}
    >
      <div className="mb-3 flex flex-col gap-1 md:flex-row md:items-center md:justify-between md:gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2.5 text-sm font-medium text-[var(--foreground)]">
            <span aria-hidden className="ui-live-dot" />
            {isAnalyzing ? "Analyse en cours…" : "Traitement en cours"}
          </p>
          {isAnalyzing ? (
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Cela peut prendre 1 à 3 minutes — ce n’est pas bloqué.
            </p>
          ) : null}
        </div>
        <p className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--muted)]">
          {activeIndex + 1}/{STEPS.length} · {STEPS[activeIndex]?.label}
        </p>
      </div>

      <ProgressBar value={percent} indeterminate />

      <ol className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        {STEPS.map((step, index) => {
          const done = index < activeIndex;
          const active = index === activeIndex;
          return (
            <li
              key={step.id}
              className={cn(
                "flex items-center gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-xs transition-colors duration-300",
                active &&
                  "border-[color-mix(in_oklab,var(--accent)_45%,var(--border))] bg-[var(--accent-soft)] text-[var(--accent)]",
                done &&
                  "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--foreground)]",
                !done &&
                  !active &&
                  "border-transparent text-[var(--muted)]",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] tabular-nums",
                  done &&
                    "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]",
                  active && "border-[var(--accent)]",
                  !done && !active && "border-[var(--border-strong)]",
                )}
              >
                {done ? "✓" : index + 1}
              </span>
              <span className="block font-medium">{step.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
