import type { Metadata } from "next";
import { Suspense } from "react";

import { DocumentManager } from "@/components/documents/manager";

export const metadata: Metadata = {
  title: "Documents",
};

export default function DocumentsPage() {
  return (
    <section className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 page-atmosphere"
      />
      <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 sm:py-10">
        <Suspense
          fallback={
            <div className="text-sm text-[var(--muted)]">
              Chargement du gestionnaire…
            </div>
          }
        >
          <DocumentManager />
        </Suspense>
      </div>
    </section>
  );
}
