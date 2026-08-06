import Link from "next/link";

import { siteConfig } from "@/config/site";

export function LandingHero() {
  return (
    <section
      id="top"
      className="landing-hero relative isolate flex min-h-[100svh] flex-col justify-end overflow-hidden"
    >
      <div aria-hidden className="landing-hero-visual absolute inset-0 -z-10" />
      <div
        aria-hidden
        className="landing-hero-scan pointer-events-none absolute inset-x-0 top-0 -z-10 h-px"
      />

      <div className="mx-auto w-full max-w-6xl px-5 pb-16 pt-28 sm:px-6 sm:pb-20 sm:pt-32">
        <p className="landing-reveal font-display text-6xl tracking-tight text-[var(--foreground)] sm:text-7xl md:text-8xl">
          {siteConfig.name}
        </p>
        <h1 className="landing-reveal landing-reveal-delay-1 mt-5 max-w-2xl text-balance text-2xl font-medium leading-snug text-[var(--foreground)] sm:text-3xl">
          Vos contrats et factures, lus en local — risques, échéances, actions.
        </h1>
        <p className="landing-reveal landing-reveal-delay-2 mt-4 max-w-xl text-pretty text-base leading-relaxed text-[var(--muted)] sm:text-lg">
          Pas un chat généraliste : une mémoire documentaire française qui
          extrait les faits, alerte avant un renouvellement, et prépare le
          courrier — sans envoyer vos PDF à ChatGPT.
        </p>
        <div className="landing-reveal landing-reveal-delay-3 mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/auth/signup"
            className="inline-flex h-11 items-center rounded-md bg-[var(--accent)] px-5 text-sm font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)]"
          >
            Analyser un PDF gratuitement
          </Link>
          <a
            href="#demo"
            className="inline-flex h-11 items-center rounded-md border border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--surface)_70%,transparent)] px-5 text-sm font-medium text-[var(--foreground)] backdrop-blur-sm transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            Voir un exemple
          </a>
        </div>
        <p className="landing-reveal landing-reveal-delay-3 mt-4 text-sm text-[var(--muted)]">
          Gratuit pour démarrer · Sans carte bancaire · Analyse via Ollama local
        </p>
      </div>
    </section>
  );
}
