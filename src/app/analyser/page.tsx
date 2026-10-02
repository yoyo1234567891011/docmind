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

      <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-5xl flex-col items-center px-5 py-12 text-center sm:px-6 md:py-20">
        <p className="animate-fade-up ui-kicker inline-flex items-center gap-2 rounded-full border border-[var(--hairline)] bg-[color-mix(in_oklab,var(--surface)_80%,transparent)] px-3 py-1 text-[var(--accent)] shadow-[var(--highlight),var(--shadow-xs)] backdrop-blur-sm">
          <span aria-hidden className="ui-live-dot h-1.5 w-1.5" />
          {siteConfig.name}
        </p>

        <h1 className="animate-fade-up-delay-1 mt-6 max-w-3xl text-balance font-display text-[2.25rem] leading-[1.06] tracking-[-0.025em] text-[var(--foreground)] md:text-[3.5rem]">
          Déposez un document. Obtenez un aperçu immédiat, puis une analyse IA.
        </h1>

        <p className="animate-fade-up-delay-2 mt-5 max-w-xl text-pretty text-base leading-relaxed text-[var(--muted)]">
          Contrats, factures, courriers — import local. L’aperçu arrive vite ;
          l’analyse IA prend en général 1 à 3 minutes.
        </p>
        <p className="animate-fade-up-delay-2 mt-2 max-w-xl text-pretty text-sm leading-relaxed text-[var(--muted)]">
          Documents PDF avec texte sélectionnable uniquement. Les PDF scannés ou
          photos ne sont pas pris en charge pour l’instant.
        </p>

        <div className="animate-fade-up-delay-3 mt-12 w-full max-w-3xl">
          <HomeUploadSection />
        </div>
      </div>
    </section>
  );
}
