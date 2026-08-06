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
        "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] transition-colors duration-200 hover:border-[var(--border-strong)] hover:text-[var(--foreground)]",
        className,
      )}
    >
      {isDark ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
    </button>
  );
}
