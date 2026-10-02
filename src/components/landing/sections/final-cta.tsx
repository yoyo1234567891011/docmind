import Link from "next/link";

import { LandingSectionLink } from "@/components/landing/landing-section-link";
import { siteConfig } from "@/config/site";

/** CTA de clôture — pattern SaaS IA (Linear / Claude / Notion). */
export function LandingFinalCta() {
  return (
    <section className="landing-section border-t border-[var(--border)]">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
        <div className="max-w-2xl">
          <h2 className="font-display text-4xl tracking-tight text-[var(--foreground)] sm:text-5xl">
            Prêt à lire votre prochain PDF autrement
          </h2>
          <p className="mt-3 text-base leading-relaxed text-[var(--muted)] sm:text-lg">
            Créez un compte, déposez un PDF texte, obtenez risques et actions —
            sans coller le fichier dans ChatGPT. Analyse via Groq (API dédiée).
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/auth/signup"
              className="inline-flex h-11 items-center rounded-[var(--radius-md)] bg-[var(--accent)] px-5 text-sm font-medium tracking-[-0.01em] text-[var(--accent-foreground)] shadow-[var(--shadow-sm)] transition-[background-color,box-shadow,transform] duration-200 hover:bg-[var(--accent-hover)] hover:shadow-[var(--shadow-md)] active:translate-y-px"
            >
              Créer mon compte gratuit
            </Link>
            <LandingSectionLink
              sectionId="tarifs"
              className="inline-flex h-11 items-center rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface)] px-5 text-sm font-medium tracking-[-0.01em] text-[var(--foreground)] shadow-[var(--shadow-sm)] transition-[border-color,color,box-shadow,transform] duration-200 hover:border-[var(--accent)] hover:text-[var(--accent)] hover:shadow-[var(--shadow-md)] active:translate-y-px"
            >
              Voir les tarifs
            </LandingSectionLink>
          </div>
          <p className="mt-4 text-sm text-[var(--muted)]">
            {siteConfig.name} · Gratuit pour démarrer · Sans carte
          </p>
        </div>
      </div>
    </section>
  );
}
