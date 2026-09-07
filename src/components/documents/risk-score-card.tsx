import { cn } from "@/lib/utils";
import {
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

function cleanReason(raw: string): string | null {
  const cleaned = cleanProseForDisplay(raw, { minLength: 12 });
  if (!cleaned) return null;
  if (endsWithIncompleteToken(cleaned) || startsWithBrokenFragment(cleaned)) {
    return null;
  }
  return cleaned;
}

function cleanExplanation(raw: string): string {
  const lines = raw
    .split(/\n+/)
    .map((line) => cleanProseForDisplay(line, { minLength: 12 }))
    .filter((line): line is string => Boolean(line))
    .filter(
      (line) =>
        !endsWithIncompleteToken(line) && !startsWithBrokenFragment(line),
    );
  if (lines.length > 0) return lines.join("\n");
  const whole = cleanProseForDisplay(raw, { minLength: 12 });
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
    <article className="animate-fade-up surface-panel rounded-2xl text-left">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
        <div>
          <h3 className="font-display text-xl tracking-tight text-[var(--foreground)]">
            Score de risque
          </h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Score pondéré sur critères justifiés
          </p>
        </div>

        <div className="text-right">
          <p className="font-display text-4xl tracking-tight text-[var(--foreground)]">
            {assessment.risk_score}
            <span className="text-lg text-[var(--muted)]">/100</span>
          </p>
          <p className={cn("text-sm font-medium", level.text)}>
            Niveau {level.label}
          </p>
        </div>
      </header>

      <div className="space-y-5 px-5 py-4">
        <div className="h-1.5 overflow-hidden rounded bg-[color-mix(in_oklab,var(--muted)_18%,transparent)]">
          <div
            className={cn("h-full rounded transition-all duration-700", level.bar)}
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
                className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    {criterion.label}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
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
          <div className="rounded-xl bg-[var(--background)] px-4 py-3">
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
