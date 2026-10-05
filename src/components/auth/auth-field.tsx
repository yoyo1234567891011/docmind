"use client";

import { useId, useState, type InputHTMLAttributes } from "react";

import { EyeIcon, EyeOffIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export function AuthField({
  label,
  className,
  type = "text",
  id: idProp,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const generatedId = useId();
  const inputId = idProp ?? generatedId;
  const isPassword = type === "password";
  const [visible, setVisible] = useState(false);
  const inputType = isPassword ? (visible ? "text" : "password") : type;

  return (
    <label className="block space-y-1.5 text-sm" htmlFor={inputId}>
      <span className="text-[13px] font-medium tracking-[-0.01em] text-[var(--muted)]">
        {label}
      </span>
      {isPassword ? (
        <div className="relative">
          <input
            id={inputId}
            type={inputType}
            className={cn(
              "ui-input bg-[var(--background)] pr-11",
              className,
            )}
            {...props}
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-[var(--radius-md)] text-[var(--muted)] transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--accent)_70%,transparent)] focus-visible:ring-offset-0"
            aria-label={visible ? "Masquer" : "Afficher"}
            aria-controls={inputId}
            aria-pressed={visible}
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? (
              <EyeOffIcon className="h-4 w-4" />
            ) : (
              <EyeIcon className="h-4 w-4" />
            )}
          </button>
        </div>
      ) : (
        <input
          id={inputId}
          type={inputType}
          className={cn("ui-input bg-[var(--background)]", className)}
          {...props}
        />
      )}
    </label>
  );
}
