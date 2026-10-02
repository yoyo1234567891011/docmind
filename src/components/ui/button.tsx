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
    "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[var(--shadow-sm)] hover:bg-[var(--accent-hover)] hover:shadow-[var(--shadow-md)] active:translate-y-px disabled:opacity-45 disabled:shadow-none",
  secondary:
    "border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--foreground)] shadow-[var(--shadow-sm)] hover:border-[var(--accent)] hover:text-[var(--accent)] hover:bg-[var(--surface-elevated)] active:translate-y-px disabled:opacity-45 disabled:shadow-none",
  ghost:
    "text-[var(--muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--foreground)] active:bg-[color-mix(in_oklab,var(--accent-soft)_80%,var(--accent)_8%)] disabled:opacity-45",
  danger:
    "text-[var(--danger)] hover:bg-[var(--danger-soft)] active:bg-[color-mix(in_oklab,var(--danger-soft)_85%,var(--danger)_8%)] disabled:opacity-45",
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
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] font-medium tracking-[-0.01em] transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-200 ease-[var(--ease-out)] disabled:cursor-not-allowed",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}
