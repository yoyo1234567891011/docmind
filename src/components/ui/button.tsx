import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[inset_0_1px_0_color-mix(in_oklab,white_18%,transparent),var(--shadow-accent)] hover:bg-[var(--accent-hover)] hover:shadow-[inset_0_1px_0_color-mix(in_oklab,white_22%,transparent),0_1px_2px_color-mix(in_oklab,var(--accent)_30%,transparent),0_10px_24px_-8px_color-mix(in_oklab,var(--accent)_60%,transparent)] disabled:opacity-45 disabled:shadow-none",
  secondary:
    "border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--foreground)] shadow-[var(--highlight),var(--shadow-xs)] hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--border-strong))] hover:bg-[var(--surface-elevated)] hover:text-[var(--accent)] hover:shadow-[var(--highlight),var(--shadow-sm)] disabled:opacity-45 disabled:shadow-none",
  ghost:
    "text-[var(--muted)] hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] hover:text-[var(--foreground)] active:bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] disabled:opacity-45",
  danger:
    "text-[var(--danger)] hover:bg-[var(--danger-soft)] active:bg-[color-mix(in_oklab,var(--danger-soft)_85%,var(--danger)_8%)] disabled:opacity-45",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-11 px-5 text-sm",
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
        "relative inline-flex select-none items-center justify-center gap-2 rounded-[var(--radius-md)] font-medium tracking-[-0.01em] transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-150 ease-[var(--ease-out)] active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}
