import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--accent-foreground)] hover:bg-[var(--accent-hover)] disabled:opacity-50",
  secondary:
    "border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50",
  ghost:
    "text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--foreground)] disabled:opacity-50",
  danger:
    "text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-50",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors duration-200 disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}
