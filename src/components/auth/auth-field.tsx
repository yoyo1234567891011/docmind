"use client";

import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function AuthField({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <input
        className={cn(
          "w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[var(--foreground)] outline-none ring-[var(--ring)] focus:ring-2",
          className,
        )}
        {...props}
      />
    </label>
  );
}
