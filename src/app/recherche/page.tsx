import type { Metadata } from "next";
import { Suspense } from "react";

import { SmartSearchView } from "@/components/search";

export const metadata: Metadata = {
  title: "Recherche intelligente",
};

export default function SmartSearchPage() {
  return (
    <section className="relative isolate overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 page-atmosphere" />
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-6">
        <Suspense fallback={<div className="text-sm text-[var(--muted)]">Chargement…</div>}>
          <SmartSearchView />
        </Suspense>
      </div>
    </section>
  );
}
