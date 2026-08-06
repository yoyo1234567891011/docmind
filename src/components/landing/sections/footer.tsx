import Link from "next/link";

import { siteConfig } from "@/config/site";

export function LandingFooter() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--background-deep)]">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-6">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="font-display text-3xl tracking-tight text-[var(--foreground)]">
              {siteConfig.name}
            </p>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--muted)]">
              Analyse documentaire locale. Privée. Actionnable.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                Produit
              </p>
              <ul className="mt-3 space-y-2 text-sm text-[var(--foreground)]">
                <li>
                  <a href="#fonctionnalites" className="hover:text-[var(--accent)]">
                    Fonctionnalités
                  </a>
                </li>
                <li>
                  <a href="#tarifs" className="hover:text-[var(--accent)]">
                    Tarifs
                  </a>
                </li>
                <li>
                  <Link href="/analyser" className="hover:text-[var(--accent)]">
                    Analyser
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
                  <Link href="/auth/login" className="hover:text-[var(--accent)]">
                    Connexion
                  </Link>
                </li>
                <li>
                  <Link href="/auth/signup" className="hover:text-[var(--accent)]">
                    Inscription
                  </Link>
                </li>
                <li>
                  <Link href="/dashboard" className="hover:text-[var(--accent)]">
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
                    href="/confidentialite"
                    className="hover:text-[var(--accent)]"
                  >
                    Confidentialité
                  </Link>
                </li>
                <li>
                  <Link href="/cgu" className="hover:text-[var(--accent)]">
                    CGU
                  </Link>
                </li>
                <li>
                  <Link href="/cgv" className="hover:text-[var(--accent)]">
                    CGV
                  </Link>
                </li>
                <li>
                  <Link
                    href="/mentions-legales"
                    className="hover:text-[var(--accent)]"
                  >
                    Mentions légales
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
                  <a href="#faq" className="hover:text-[var(--accent)]">
                    FAQ
                  </a>
                </li>
                <li>
                  <Link href="/auth/signup" className="hover:text-[var(--accent)]">
                    Créer un compte
                  </Link>
                </li>
                <li>
                  <Link href="/signalement" className="hover:text-[var(--accent)]">
                    Signalement
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <p className="mt-12 border-t border-[var(--border)] pt-6 text-xs text-[var(--muted)]">
          © {new Date().getFullYear()} {siteConfig.name}. Documents traités sur
          l’infrastructure DocMind — voir politique de confidentialité.
        </p>
      </div>
    </footer>
  );
}
