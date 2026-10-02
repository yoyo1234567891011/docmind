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
        "group inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface)] text-[var(--muted)] shadow-[var(--highlight),var(--shadow-xs)] transition-[color,background-color,border-color,box-shadow,transform] duration-150 hover:border-[var(--border-strong)] hover:text-[var(--foreground)] hover:shadow-[var(--highlight),var(--shadow-sm)] active:scale-95",
        className,
      )}
    >
      {isDark ? (
        <SunIcon className="h-4 w-4 transition-transform duration-500 ease-[var(--ease-out)] group-hover:rotate-45" />
      ) : (
        <MoonIcon className="h-4 w-4 transition-transform duration-500 ease-[var(--ease-out)] group-hover:-rotate-12" />
      )}
    </button>
  );
}
