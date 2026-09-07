import Link from "next/link";

import { siteConfig } from "@/config/site";

export function Footer() {
  return (
    <footer className="border-t border-[var(--border)]/80">
      <div className="mx-auto flex min-h-16 max-w-6xl flex-col items-start justify-center gap-2 px-5 py-4 text-sm text-[var(--muted)] sm:px-6 md:h-16 md:flex-row md:items-center md:justify-between md:py-0">
        <p>
          &copy; {new Date().getFullYear()} {siteConfig.name}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs md:text-sm">
          <Link
            href="/confidentialite"
            className="hover:text-[var(--accent)] hover:underline"
          >
            Confidentialité
          </Link>
          <Link
            href="/cgu"
            className="hover:text-[var(--accent)] hover:underline"
          >
            CGU
          </Link>
          <Link
            href="/cgv"
            className="hover:text-[var(--accent)] hover:underline"
          >
            CGV
          </Link>
          <Link
            href="/mentions-legales"
            className="hover:text-[var(--accent)] hover:underline"
          >
            Mentions légales
          </Link>
          <Link
            href="/feedback"
            className="hover:text-[var(--accent)] hover:underline"
          >
            Avis
          </Link>
          <Link
            href="/guide"
            className="hover:text-[var(--accent)] hover:underline"
          >
            Guide
          </Link>
          <Link
            href="/signalement"
            className="hover:text-[var(--accent)] hover:underline"
          >
            Signalement
          </Link>
        </div>
      </div>
    </footer>
  );
}
