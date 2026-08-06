import type { Metadata } from "next";

import { FinanceView } from "@/components/insights/finance-view";

export const metadata: Metadata = {
  title: "Finances",
};

export default function FinancesPage() {
  return (
    <section className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 page-atmosphere"
      />
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-6">
        <FinanceView />
      </div>
    </section>
  );
}
