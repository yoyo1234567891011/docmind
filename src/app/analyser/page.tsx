import type { Metadata } from "next";

import { HomeUploadSection } from "@/components/documents";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Analyser",
  description: `Importez un PDF pour l’analyser avec ${siteConfig.name}.`,
};

export default function AnalyserPage() {
  return (
    <section className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 page-atmosphere"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 page-grid"
      />

      <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-5xl flex-col items-center px-5 py-14 text-center sm:px-6 sm:py-20">
        <p className="animate-fade-up font-display text-5xl tracking-tight text-[var(--foreground)] sm:text-6xl">
          {siteConfig.name}
        </p>

        <h1 className="animate-fade-up-delay-1 mt-5 max-w-2xl text-balance text-xl font-medium text-[var(--foreground)] sm:text-2xl">
          Déposez un document. Comprenez-le en un clin d&apos;œil.
        </h1>

        <p className="animate-fade-up-delay-2 mt-3 max-w-xl text-pretty text-base leading-relaxed text-[var(--muted)]">
          Contrats, factures, courriers — importez un PDF pour une analyse
          claire, structurée et 100&nbsp;% locale.
        </p>

        <div className="animate-fade-up-delay-3 mt-10 w-full max-w-3xl">
          <HomeUploadSection />
        </div>
      </div>
    </section>
  );
}
