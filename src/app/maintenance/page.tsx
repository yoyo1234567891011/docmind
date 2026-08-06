import type { Metadata } from "next";

import { getMaintenanceMessage, getAppVersion } from "@/config/runtime";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Maintenance",
};

export default function MaintenancePage() {
  const message = getMaintenanceMessage();

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center px-5 py-16 text-center">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 page-atmosphere" />
      <p className="font-display text-4xl tracking-tight text-[var(--foreground)] sm:text-5xl">
        {siteConfig.name}
      </p>
      <h1 className="mt-6 text-xl font-medium text-[var(--foreground)] sm:text-2xl">
        Maintenance en cours
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--muted)] sm:text-base">
        {message}
      </p>
      <p className="mt-8 text-xs text-[var(--muted)]">
        Version {getAppVersion()}
      </p>
    </main>
  );
}
