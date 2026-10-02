import Link from "next/link";

import { landingCtaPrimary, landingCtaSecondary } from "@/components/landing/landing-cta-styles";
import { LandingSectionLink } from "@/components/landing/landing-section-link";
import {
  AlertIcon,
  BellIcon,
  CheckIcon,
  ChevronRightIcon,
  FileIcon,
} from "@/components/ui/icons";
import { siteConfig } from "@/config/site";

/** Composition décorative (sans texte) évoquant une fiche analysée. */
function HeroArtifact() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-[30rem] select-none">
      <div className="landing-artifact landing-reveal landing-reveal-delay-2 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[var(--hairline)] px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--border-strong)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--border-strong)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--border-strong)]" />
          <span className="ml-3 flex items-center gap-2">
            <FileIcon className="h-3.5 w-3.5 text-[var(--muted)]" />
            <span className="landing-artifact-line w-28" />
          </span>
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-6 p-6">
          <div className="space-y-3">
            <span className="landing-artifact-line block w-2/3 bg-[color-mix(in_oklab,var(--foreground)_16%,transparent)]" />
            <span className="landing-artifact-line block w-full" />
            <span className="relative block">
              <span className="landing-artifact-mark absolute -inset-x-1 -inset-y-1" />
              <span className="landing-artifact-line relative block w-11/12" />
            </span>
            <span className="landing-artifact-line block w-4/5" />
            <span className="landing-artifact-line block w-full" />
            <span className="relative block">
              <span className="absolute -inset-x-1 -inset-y-1 rounded-[0.25rem] bg-[color-mix(in_oklab,var(--warning)_14%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--warning)_30%,transparent)]" />
              <span className="landing-artifact-line relative block w-3/4" />
            </span>
            <span className="landing-artifact-line block w-5/6" />
            <span className="landing-artifact-line block w-2/5" />
          </div>

          <div className="flex w-20 flex-col items-center gap-3 pt-1">
            <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
              <circle
                cx="32"
                cy="32"
                r="26"
                fill="none"
                strokeWidth="6"
                className="stroke-[color-mix(in_oklab,var(--foreground)_8%,transparent)]"
              />
              <circle
                cx="32"
                cy="32"
                r="26"
                fill="none"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray="163.4"
                strokeDashoffset="52"
                className="stroke-[var(--accent)]"
              />
            </svg>
            <span className="landing-artifact-line block w-full" />
            <span className="landing-artifact-line block w-2/3" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-px border-t border-[var(--hairline)] bg-[var(--hairline)]">
          {[0, 1, 2].map((key) => (
            <div key={key} className="space-y-2 bg-[var(--surface)] px-4 py-3.5">
              <span className="landing-artifact-line block h-1.5 w-1/2 bg-[color-mix(in_oklab,var(--accent)_30%,transparent)]" />
              <span className="landing-artifact-line block w-4/5" />
            </div>
          ))}
        </div>
      </div>

      <div className="landing-artifact landing-artifact-float absolute -left-10 top-[42%] hidden w-52 p-3.5 xl:block">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--warning-soft)] text-[var(--warning)]">
            <AlertIcon className="h-4 w-4" />
          </span>
          <span className="flex-1 space-y-2 pt-1">
            <span className="landing-artifact-line block w-full" />
            <span className="landing-artifact-line block w-2/3" />
          </span>
        </div>
      </div>

      <div className="landing-artifact landing-artifact-float-slow absolute -right-6 -top-6 hidden w-44 p-3.5 sm:block">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <BellIcon className="h-4 w-4" />
          </span>
          <span className="flex-1 space-y-2">
            <span className="landing-artifact-line block w-full" />
            <span className="landing-artifact-line block w-1/2" />
          </span>
        </div>
      </div>

      <div className="landing-artifact landing-artifact-float absolute -bottom-7 right-8 hidden w-56 p-3.5 sm:block">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[var(--shadow-accent)]">
            <CheckIcon className="h-4 w-4" />
          </span>
          <span className="flex-1 space-y-2">
            <span className="landing-artifact-line block w-full" />
            <span className="landing-artifact-line block w-3/5" />
          </span>
          <ChevronRightIcon className="h-4 w-4 text-[var(--muted)]" />
        </div>
      </div>
    </div>
  );
}

export function LandingHero() {
  return (
    <section
      id="top"
      className="landing-hero relative isolate overflow-hidden"
    >
      <div aria-hidden className="landing-hero-visual absolute inset-0 -z-10" />
      <div
        aria-hidden
        className="landing-hero-scan pointer-events-none absolute inset-x-0 top-0 -z-10 h-px"
      />

      <div className="mx-auto grid w-full max-w-6xl items-center gap-14 px-5 pb-20 pt-28 sm:px-6 sm:pb-24 sm:pt-36 lg:min-h-[min(88svh,48rem)] lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:gap-12 lg:pb-20 lg:pt-28">
        <div>
          <p className="landing-reveal landing-eyebrow text-[var(--accent)]">
            {siteConfig.name}
          </p>
          <h1 className="landing-reveal landing-reveal-delay-1 mt-5 max-w-3xl text-balance font-display text-[2.6rem] leading-[1.04] tracking-[-0.03em] text-[var(--foreground)] sm:text-6xl md:text-[4.25rem]">
            Vos contrats et factures, analysés en privé
          </h1>
          <p className="landing-reveal landing-reveal-delay-2 mt-6 max-w-xl text-pretty text-lg font-medium leading-snug tracking-[-0.015em] text-[var(--foreground)] sm:text-xl">
            Risques prioritaires, échéances datées et prochaines actions — dans
            un espace documentaire qui vous appartient.
          </p>
          <p className="landing-reveal landing-reveal-delay-2 mt-4 max-w-xl text-pretty text-[15px] leading-relaxed text-[var(--muted)]">
            Mémoire documentaire en français : fiches, alertes et courriers. Le
            texte est analysé via une API dédiée — pas de PDF collé dans ChatGPT.
            PDF avec texte sélectionnable uniquement (pas de scans).
          </p>
          <div className="landing-reveal landing-reveal-delay-3 mt-9 flex flex-wrap items-center gap-3">
            <Link href="/auth/signup" className={landingCtaPrimary}>
              Analyser un PDF gratuitement
              <ChevronRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <LandingSectionLink sectionId="demo" className={landingCtaSecondary}>
              Voir un exemple
            </LandingSectionLink>
          </div>
          <p className="landing-reveal landing-reveal-delay-3 mt-5 flex flex-wrap items-center gap-x-2 text-sm text-[var(--muted)]">
            <span className="font-mono text-[12px] tabular-nums">
              Analyse typique ~1–3 min
            </span>
            <span aria-hidden>·</span>
            <Link
              href="/guide"
              className="text-[var(--accent)] underline-offset-4 hover:underline"
            >
              Guide des PDF acceptés
            </Link>
          </p>
        </div>

        <div className="hidden md:block">
          <HeroArtifact />
        </div>
      </div>
    </section>
  );
}
