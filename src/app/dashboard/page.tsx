import type { Metadata } from "next";

import { DashboardView } from "@/components/dashboard";

export const metadata: Metadata = {
  title: "Tableau de bord",
};

export default function DashboardPage() {
  return (
    <section className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 page-atmosphere"
      />
      <div
        aria-hidden
        className="page-grid pointer-events-none absolute inset-0 -z-10 opacity-30"
      />

      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6 sm:py-12">
        <DashboardView />
      </div>
    </section>
  );
}
