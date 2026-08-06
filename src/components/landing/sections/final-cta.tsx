import Link from "next/link";

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
            Créez un compte, déposez un document, obtenez risques et actions —
            sans l’envoyer à ChatGPT.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/auth/signup"
              className="inline-flex h-11 items-center rounded-md bg-[var(--accent)] px-5 text-sm font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)]"
            >
              Créer mon compte gratuit
            </Link>
            <a
              href="#tarifs"
              className="inline-flex h-11 items-center rounded-md border border-[var(--border-strong)] px-5 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              Voir les tarifs
            </a>
          </div>
          <p className="mt-4 text-sm text-[var(--muted)]">
            {siteConfig.name} · Gratuit pour démarrer · Sans carte
          </p>
        </div>
      </div>
    </section>
  );
}
