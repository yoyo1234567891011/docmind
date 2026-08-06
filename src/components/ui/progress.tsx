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
          {!indeterminate ? <span>{Math.round(clamped)}%</span> : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
        aria-label={label || "Progression"}
        className={cn(
          "relative h-1.5 overflow-hidden rounded bg-[color-mix(in_oklab,var(--muted)_18%,transparent)]",
          trackClassName,
        )}
      >
        {indeterminate ? (
          <div
            className={cn(
              "absolute inset-y-0 w-1/3 rounded bg-[var(--accent)] animate-progress-indeterminate",
              barClassName,
            )}
          />
        ) : (
          <div
            className={cn(
              "h-full rounded bg-[var(--accent)] transition-[width] duration-500 ease-out",
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

  return (
    <div
      className={cn(
        "surface-panel animate-fade-up rounded-2xl px-5 py-4",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-[var(--foreground)]">
          Traitement en cours
        </p>
        <p className="text-xs text-[var(--muted)]">
          {STEPS[activeIndex]?.label}
        </p>
      </div>

      <ProgressBar value={percent} indeterminate />

      <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STEPS.map((step, index) => {
          const done = index < activeIndex;
          const active = index === activeIndex;
          return (
            <li
              key={step.id}
              className={cn(
                "rounded-lg border px-3 py-2 text-xs transition-colors duration-300",
                active &&
                  "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]",
                done &&
                  "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--foreground)]",
                !done &&
                  !active &&
                  "border-transparent text-[var(--muted)]",
              )}
            >
              <span className="block font-medium">{step.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
