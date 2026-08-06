"use client";

import type { ReactNode } from "react";

import { siteConfig } from "@/config/site";
import { AnalyzeIcon } from "@/components/ui/icons";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-5 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--accent-mist),transparent_55%),linear-gradient(180deg,var(--background-deep),var(--background))]"
      />
      <div className="relative w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent)] text-[var(--accent-foreground)]">
            <AnalyzeIcon className="h-5 w-5" />
          </div>
          <p className="font-display text-2xl tracking-tight">{siteConfig.name}</p>
          <h1 className="mt-3 text-xl font-semibold text-[var(--foreground)]">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1.5 text-sm text-[var(--muted)]">{subtitle}</p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
          {children}
        </div>

        {footer ? (
          <div className="text-center text-sm text-[var(--muted)]">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
