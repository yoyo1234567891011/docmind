import type { ReactNode } from "react";

import { AlertIcon, CheckIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

type AlertTone = "error" | "success" | "info";

interface AlertProps {
  tone?: AlertTone;
  title?: string;
  children: ReactNode;
  className?: string;
}

const toneStyles: Record<
  AlertTone,
  { root: string; icon: string; rail: string }
> = {
  error: {
    root: "border-[color-mix(in_oklab,var(--danger)_24%,var(--border))] bg-[color-mix(in_oklab,var(--danger-soft)_70%,var(--surface))]",
    icon: "bg-[color-mix(in_oklab,var(--danger)_14%,transparent)] text-[var(--danger)]",
    rail: "bg-[var(--danger)]",
  },
  success: {
    root: "border-[color-mix(in_oklab,var(--success)_24%,var(--border))] bg-[color-mix(in_oklab,var(--success-soft)_70%,var(--surface))]",
    icon: "bg-[color-mix(in_oklab,var(--success)_14%,transparent)] text-[var(--success)]",
    rail: "bg-[var(--success)]",
  },
  info: {
    root: "border-[color-mix(in_oklab,var(--accent)_24%,var(--border))] bg-[color-mix(in_oklab,var(--accent-soft)_70%,var(--surface))]",
    icon: "bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] text-[var(--accent)]",
    rail: "bg-[var(--accent)]",
  },
};

export function Alert({
  tone = "error",
  title,
  children,
  className,
}: AlertProps) {
  const styles = toneStyles[tone];
  return (
    <div
      role="alert"
      className={cn(
        "animate-fade-up relative flex gap-3 overflow-hidden rounded-[var(--radius-lg)] border py-3.5 pl-4 pr-4 text-left shadow-[var(--highlight),var(--shadow-xs)]",
        styles.root,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("absolute inset-y-0 left-0 w-[3px]", styles.rail)}
      />
      <span
        className={cn(
          "mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          styles.icon,
        )}
      >
        {tone === "success" ? (
          <CheckIcon className="h-3.5 w-3.5" />
        ) : (
          <AlertIcon className="h-3.5 w-3.5" />
        )}
      </span>
      <div className="min-w-0 space-y-0.5 pt-0.5">
        {title ? (
          <p className="text-sm font-semibold tracking-[-0.01em] text-[var(--foreground)]">
            {title}
          </p>
        ) : null}
        <div className="text-sm leading-relaxed text-[color-mix(in_oklab,var(--foreground)_86%,var(--muted))]">
          {children}
        </div>
      </div>
    </div>
  );
}
