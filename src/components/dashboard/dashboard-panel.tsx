import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { RiskAssessment } from "@/types";

export function getRiskToneClass(
  level: RiskAssessment["risk_level"],
): string {
  switch (level) {
    case "critique":
    case "eleve":
      return "text-[var(--danger)] bg-[var(--danger-soft)] border border-[color-mix(in_oklab,var(--danger)_22%,transparent)]";
    case "modere":
      return "text-[var(--warning)] bg-[var(--warning-soft)] border border-[color-mix(in_oklab,var(--warning)_22%,transparent)]";
    default:
      return "text-[var(--accent)] bg-[var(--accent-soft)] border border-[color-mix(in_oklab,var(--accent)_22%,transparent)]";
  }
}

export function getRiskBarClass(level: string): string {
  switch (level) {
    case "critique":
    case "eleve":
      return "bg-[var(--danger)]";
    case "modere":
      return "bg-[var(--warning)]";
    default:
      return "bg-[var(--accent)]";
  }
}

export function DashboardPanel({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "surface-panel overflow-hidden rounded-[var(--radius-2xl)]",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--hairline)] px-5 py-4 sm:px-6 sm:py-5">
        <div className="min-w-0">
          <h2 className="font-display text-[1.375rem] leading-tight tracking-tight text-[var(--foreground)]">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
              {subtitle}
            </p>
          ) : null}
        </div>
        {action}
      </header>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}
