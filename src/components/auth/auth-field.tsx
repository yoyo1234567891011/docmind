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
      <span className="text-[13px] font-medium tracking-[-0.01em] text-[var(--muted)]">
        {label}
      </span>
      <input className={cn("ui-input bg-[var(--background)]", className)} {...props} />
    </label>
  );
}
