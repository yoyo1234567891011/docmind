"use client";

import { MoonIcon, SunIcon } from "@/components/ui/icons";
import { useTheme } from "@/components/theme/theme-provider";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Activer le mode clair" : "Activer le mode sombre"}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--border)_88%,transparent)] bg-[var(--surface)] text-[var(--muted)] shadow-[var(--shadow-sm)] transition-[color,background-color,border-color,box-shadow] duration-200 hover:border-[var(--border-strong)] hover:text-[var(--foreground)] hover:shadow-[var(--shadow-md)]",
        className,
      )}
    >
      {isDark ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
    </button>
  );
}
