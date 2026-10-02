import Link from "next/link";

import { siteConfig } from "@/config/site";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--surface)_55%,transparent)]">
      <div className="mx-auto flex min-h-[4.25rem] max-w-6xl flex-col items-start justify-center gap-3 px-5 py-5 text-sm text-[var(--muted)] sm:px-6 md:flex-row md:items-center md:justify-between md:py-0">
        <p className="tracking-[-0.01em]">
          &copy; {new Date().getFullYear()} {siteConfig.name}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs md:text-[13px]">
          <Link
            href="/mentions-legales"
            className="transition-colors hover:text-[var(--foreground)]"
          >
            Mentions
          </Link>
          <Link
            href="/cgv"
            className="transition-colors hover:text-[var(--foreground)]"
          >
            CGV
          </Link>
          <Link
            href="/confidentialite"
            className="transition-colors hover:text-[var(--foreground)]"
          >
            Confidentialité
          </Link>
          <Link
            href="/cgu"
            className="transition-colors hover:text-[var(--foreground)]"
          >
            CGU
          </Link>
          <Link
            href="/cookies"
            className="transition-colors hover:text-[var(--foreground)]"
          >
            Cookies
          </Link>
          <Link
            href="/guide"
            className="transition-colors hover:text-[var(--foreground)]"
          >
            Guide
          </Link>
          <Link
            href="/feedback"
            className="transition-colors hover:text-[var(--foreground)]"
          >
            Avis
          </Link>
          <Link
            href="/signalement"
            className="transition-colors hover:text-[var(--foreground)]"
          >
            Signalement
          </Link>
        </div>
      </div>
    </footer>
  );
}
