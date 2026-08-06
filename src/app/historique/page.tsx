import type { Metadata } from "next";

import { HistoryList } from "@/components/history";

export const metadata: Metadata = {
  title: "Historique",
};

export default function HistoryPage() {
  return (
    <section className="relative isolate overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 page-atmosphere" />

      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-6">
        <div className="mb-8 animate-fade-up text-left">
          <h1 className="font-display text-4xl tracking-tight text-[var(--foreground)] sm:text-5xl">
            Historique
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)] sm:text-base">
            Retrouvez, filtrez et rouvrez vos analyses précédentes.
          </p>
        </div>

        <HistoryList />
      </div>
    </section>
  );
}
