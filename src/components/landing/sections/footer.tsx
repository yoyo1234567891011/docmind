import Link from "next/link";

import { LandingSectionLink } from "@/components/landing/landing-section-link";
import { siteConfig } from "@/config/site";

export function LandingFooter() {
  return (
    <footer className="border-t border-[var(--hairline)] bg-[var(--background-deep)]">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-6">
        <div className="flex flex-col gap-12 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="font-display text-4xl tracking-tight text-[var(--foreground)]">
              {siteConfig.name}
            </p>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--muted)]">
              Analyse documentaire privée. Structurée. Actionnable. PDF texte
              uniquement.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                Produit
              </p>
              <ul className="mt-3 space-y-2 text-sm text-[var(--foreground)]">
                <li>
                  <LandingSectionLink
                    sectionId="fonctionnalites"
                    className="text-[var(--muted)] transition-colors duration-150 hover:text-[var(--foreground)]"
                  >
                    Fonctionnalités
                  </LandingSectionLink>
                </li>
                <li>
                  <LandingSectionLink
                    sectionId="tarifs"
                    className="text-[var(--muted)] transition-colors duration-150 hover:text-[var(--foreground)]"
                  >
                    Tarifs
                  </LandingSectionLink>
                </li>
                <li>
                  <Link href="/analyser" className="text-[var(--muted)] transition-colors duration-150 hover:text-[var(--foreground)]">
                    Analyser
                  </Link>
                </li>
                <li>
                  <Link href="/guide" className="text-[var(--muted)] transition-colors duration-150 hover:text-[var(--foreground)]">
                    Guide
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                Compte
              </p>
              <ul className="mt-3 space-y-2 text-sm text-[var(--foreground)]">
                <li>
                  <Link href="/auth/login" className="text-[var(--muted)] transition-colors duration-150 hover:text-[var(--foreground)]">
                    Connexion
                  </Link>
                </li>
                <li>
                  <Link href="/auth/signup" className="text-[var(--muted)] transition-colors duration-150 hover:text-[var(--foreground)]">
                    Inscription
                  </Link>
                </li>
                <li>
                  <Link href="/dashboard" className="text-[var(--muted)] transition-colors duration-150 hover:text-[var(--foreground)]">
                    Tableau de bord
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                Légal
              </p>
              <ul className="mt-3 space-y-2 text-sm text-[var(--foreground)]">
                <li>
                  <Link
                    href="/mentions-legales"
                    className="text-[var(--muted)] transition-colors duration-150 hover:text-[var(--foreground)]"
                  >
                    Mentions légales
                  </Link>
                </li>
                <li>
                  <Link href="/cgv" className="text-[var(--muted)] transition-colors duration-150 hover:text-[var(--foreground)]">
                    CGV
                  </Link>
                </li>
                <li>
                  <Link
                    href="/confidentialite"
                    className="text-[var(--muted)] transition-colors duration-150 hover:text-[var(--foreground)]"
                  >
                    Confidentialité
                  </Link>
                </li>
                <li>
                  <Link href="/cgu" className="text-[var(--muted)] transition-colors duration-150 hover:text-[var(--foreground)]">
                    CGU
                  </Link>
                </li>
                <li>
                  <Link href="/cookies" className="text-[var(--muted)] transition-colors duration-150 hover:text-[var(--foreground)]">
                    Cookies
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                Support
              </p>
              <ul className="mt-3 space-y-2 text-sm text-[var(--foreground)]">
                <li>
                  <LandingSectionLink
                    sectionId="faq"
                    className="text-[var(--muted)] transition-colors duration-150 hover:text-[var(--foreground)]"
                  >
                    FAQ
                  </LandingSectionLink>
                </li>
                <li>
                  <Link href="/feedback" className="text-[var(--muted)] transition-colors duration-150 hover:text-[var(--foreground)]">
                    Avis
                  </Link>
                </li>
                <li>
                  <Link href="/signalement" className="text-[var(--muted)] transition-colors duration-150 hover:text-[var(--foreground)]">
                    Signalement
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <p className="mt-14 border-t border-[var(--hairline)] pt-6 text-xs leading-relaxed text-[var(--muted)]">
          © {new Date().getFullYear()} {siteConfig.name}. Extraction du texte
          sur nos serveurs ; analyse IA via Groq —{" "}
          <Link href="/confidentialite" className="hover:underline">
            confidentialité
          </Link>
          .
        </p>
      </div>
    </footer>
  );
}
