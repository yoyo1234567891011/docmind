import type { Metadata } from "next";

import { AlertsCenterView } from "@/components/alerts";

export const metadata: Metadata = {
  title: "Notifications",
};

export default function AlertsPage() {
  return (
    <section className="relative isolate overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 page-atmosphere" />
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-6">
        <AlertsCenterView />
      </div>
    </section>
  );
}
