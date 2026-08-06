import Link from "next/link";

import { siteConfig } from "@/config/site";

export function Footer() {
  return (
    <footer className="border-t border-[var(--border)]/80">
      <div className="mx-auto flex h-16 max-w-6xl flex-col items-start justify-center gap-2 px-5 text-sm text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          © {new Date().getFullYear()} {siteConfig.name}
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm">
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
          <Link href="/feedback" className="hover:text-[var(--accent)] hover:underline">
            Avis
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
