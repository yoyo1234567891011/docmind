import { cn } from "@/lib/utils";
import {
  cleanExcerptForDisplay,
  cleanProseForDisplay,
  endsWithIncompleteToken,
  startsWithBrokenFragment,
} from "@/ai/post-processing/display-cleanup";
import { isProdDisplayNoise } from "@/ai/post-processing/prod-quality";
import type { RiskAssessment } from "@/types";

interface RiskScoreCardProps {
  assessment: Pick<
    RiskAssessment,
    "risk_score" | "risk_level" | "risk_explanation" | "risk_criteria"
  >;
}

function getLevelMeta(level: RiskAssessment["risk_level"]) {
  switch (level) {
    case "critique":
      return {
        label: "Critique",
        text: "text-[var(--danger)]",
        bar: "bg-[var(--danger)]",
      };
    case "eleve":
      return {
        label: "Élevé",
        text: "text-[var(--danger)]",
        bar: "bg-[var(--danger)]",
      };
    case "modere":
      return {
        label: "Modéré",
        text: "text-[var(--warning)]",
        bar: "bg-[var(--warning)]",
      };
    default:
      return {
        label: "Faible",
        text: "text-[var(--accent)]",
        bar: "bg-[var(--accent)]",
      };
  }
}

/** Preuves / raisons du score : même cleanup que les extraits de risques. */
function cleanReason(raw: string): string | null {
  const asExcerpt = cleanExcerptForDisplay(raw);
  if (asExcerpt) return asExcerpt;
  const cleaned = cleanProseForDisplay(raw, { minLength: 12 });
  if (!cleaned) return null;
  if (endsWithIncompleteToken(cleaned) || startsWithBrokenFragment(cleaned)) {
    return null;
  }
  if (/^[/\\|]|^(?:an|ans)\s+[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜÇ]/i.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function cleanExplanation(raw: string): string {
  const lines = raw
    .split(/\n+/)
    .map((line) => cleanExcerptForDisplay(line) ?? cleanProseForDisplay(line, { minLength: 12 }))
    .filter((line): line is string => Boolean(line))
    .filter(
      (line) =>
        !endsWithIncompleteToken(line) && !startsWithBrokenFragment(line),
    );
  if (lines.length > 0) return lines.join("\n");
  const whole =
    cleanExcerptForDisplay(raw) ?? cleanProseForDisplay(raw, { minLength: 12 });
  if (
    whole &&
    !endsWithIncompleteToken(whole) &&
    !startsWithBrokenFragment(whole)
  ) {
    return whole;
  }
  // Trop abîmé → ne pas afficher une coupe mid-mot
  return "";
}

export function RiskScoreCard({ assessment }: RiskScoreCardProps) {
  const level = getLevelMeta(assessment.risk_level);
  const explanation = cleanExplanation(assessment.risk_explanation || "");

  return (
    <article className="animate-fade-up surface-panel rounded-[var(--radius-2xl)] text-left">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--hairline)] px-5 py-5 sm:px-6">
        <div>
          <h3 className="font-display text-[1.375rem] tracking-tight text-[var(--foreground)]">
            Score de risque
          </h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Score pondéré sur critères justifiés
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="font-display text-[2.5rem] leading-none tracking-tight tabular-nums text-[var(--foreground)]">
              {assessment.risk_score}
              <span className="ml-0.5 font-sans text-base text-[var(--muted)]">/100</span>
            </p>
            <p className={cn("mt-1.5 text-sm font-medium", level.text)}>
              Niveau {level.label}
            </p>
          </div>
          <svg
            aria-hidden
            viewBox="0 0 48 48"
            className={cn("h-12 w-12 -rotate-90", level.text)}
          >
            <circle
              cx="24"
              cy="24"
              r="20"
              fill="none"
              strokeWidth="4"
              className="stroke-[color-mix(in_oklab,var(--muted)_16%,transparent)]"
            />
            <circle
              cx="24"
              cy="24"
              r="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={125.66}
              strokeDashoffset={
                125.66 * (1 - Math.max(0, Math.min(100, assessment.risk_score)) / 100)
              }
              className="transition-[stroke-dashoffset] duration-1000 ease-[var(--ease-out)]"
            />
          </svg>
        </div>
      </header>

      <div className="space-y-5 px-5 py-5 sm:px-6">
        <div className="h-1 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--muted)_14%,transparent)]">
          <div
            className={cn("h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out)]", level.bar)}
            style={{ width: `${assessment.risk_score}%` }}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {assessment.risk_criteria.map((criterion) => {
            const rawReason = criterion.reasons[0];
            const reason =
              rawReason && !isProdDisplayNoise(rawReason)
                ? cleanReason(rawReason)
                : null;
            return (
              <div
                key={criterion.id}
                className={cn(
                  "rounded-[var(--radius-lg)] border px-3.5 py-3 shadow-[var(--highlight)] transition-colors",
                  criterion.detected
                    ? "border-[color-mix(in_oklab,var(--warning)_25%,var(--border))] bg-[color-mix(in_oklab,var(--warning-soft)_45%,var(--surface))]"
                    : "border-[var(--hairline)] bg-[color-mix(in_oklab,var(--surface-elevated)_70%,var(--surface))]",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    {criterion.label}
                  </p>
                  <p className="font-mono text-[11px] tabular-nums text-[var(--muted)]">
                    {criterion.score}/{criterion.max_score}
                  </p>
                </div>
                <p
                  className={cn(
                    "mt-1 text-xs font-medium",
                    criterion.detected
                      ? "text-[var(--warning)]"
                      : "text-[var(--muted)]",
                  )}
                >
                  {criterion.detected ? "Détecté" : "Non détecté"}
                </p>
                {reason ? (
                  <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--foreground)]">
                    {reason}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        {explanation ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--hairline)] bg-[color-mix(in_oklab,var(--background)_70%,var(--surface))] px-4 py-3.5">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
              Pourquoi ce score
            </p>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--foreground)]">
              {explanation}
            </pre>
          </div>
        ) : null}
      </div>
    </article>
  );
}
