import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { RiskAssessment } from "@/types";

export function getRiskToneClass(
  level: RiskAssessment["risk_level"],
): string {
  switch (level) {
    case "critique":
    case "eleve":
      return "text-[var(--danger)] bg-[var(--danger-soft)]";
    case "modere":
      return "text-[var(--warning)] bg-[var(--warning-soft)]";
    default:
      return "text-[var(--accent)] bg-[var(--accent-soft)]";
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
    <section className={cn("surface-panel rounded-2xl", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
        <div>
          <h2 className="font-display text-xl text-[var(--foreground)]">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-sm text-[var(--muted)]">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
