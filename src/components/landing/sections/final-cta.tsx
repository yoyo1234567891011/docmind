import Link from "next/link";

import { landingCtaPrimary, landingCtaSecondary } from "@/components/landing/landing-cta-styles";
import { LandingSectionLink } from "@/components/landing/landing-section-link";
import { ChevronRightIcon } from "@/components/ui/icons";
import { siteConfig } from "@/config/site";

/** CTA de clôture — pattern SaaS IA (Linear / Claude / Notion). */
export function LandingFinalCta() {
  return (
    <section className="landing-section border-t border-[var(--border)]">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
        <div className="relative isolate overflow-hidden rounded-[var(--radius-2xl)] border border-[color-mix(in_oklab,var(--accent)_22%,var(--border))] bg-[var(--surface)] px-6 py-12 text-center shadow-[var(--highlight),var(--shadow-lg)] sm:px-12 sm:py-16 lg:py-20">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,color-mix(in_oklab,var(--accent)_14%,transparent),transparent_70%)]"
          />
          <div
            aria-hidden
            className="page-grid pointer-events-none absolute inset-0 -z-10 opacity-60"
          />
          <p className="landing-eyebrow justify-center text-[var(--accent)]">Démarrer</p>
          <h2 className="mx-auto mt-4 max-w-2xl font-display text-[2.25rem] leading-[1.06] tracking-[-0.025em] text-[var(--foreground)] sm:text-5xl lg:text-[3.5rem]">
            Prêt à lire votre prochain PDF autrement ?
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-[var(--muted)] sm:text-lg">
            Créez un compte, déposez un PDF texte, obtenez risques et actions —
            sans coller le fichier dans ChatGPT. Analyse via Groq (API dédiée).
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/auth/signup" className={landingCtaPrimary}>
              Créer mon compte gratuit
              <ChevronRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <LandingSectionLink sectionId="tarifs" className={landingCtaSecondary}>
              Voir les tarifs
            </LandingSectionLink>
          </div>
          <p className="mt-6 font-mono text-[12px] text-[var(--muted)]">
            {siteConfig.name} · Gratuit pour démarrer · Sans carte bancaire
          </p>
        </div>
      </div>
    </section>
  );
}
