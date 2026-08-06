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

const toneStyles: Record<AlertTone, string> = {
  error:
    "border-[color-mix(in_oklab,var(--danger)_35%,var(--border))] bg-[var(--danger-soft)] text-[var(--danger)]",
  success:
    "border-[color-mix(in_oklab,var(--success)_35%,var(--border))] bg-[var(--success-soft)] text-[var(--success)]",
  info: "border-[color-mix(in_oklab,var(--accent)_35%,var(--border))] bg-[var(--accent-soft)] text-[var(--accent)]",
};

export function Alert({
  tone = "error",
  title,
  children,
  className,
}: AlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        "animate-fade-up flex gap-3 rounded-xl border px-4 py-3 text-left",
        toneStyles[tone],
        className,
      )}
    >
      <span className="mt-0.5 shrink-0">
        {tone === "success" ? (
          <CheckIcon className="h-4 w-4" />
        ) : (
          <AlertIcon className="h-4 w-4" />
        )}
      </span>
      <div className="min-w-0 space-y-1">
        {title ? (
          <p className="text-sm font-medium text-[var(--foreground)]">{title}</p>
        ) : null}
        <div className="text-sm leading-relaxed text-[var(--foreground)]">
          {children}
        </div>
      </div>
    </div>
  );
}
