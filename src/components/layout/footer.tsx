import Link from "next/link";

import { siteConfig } from "@/config/site";

const FOOTER_LINKS = [
  { href: "/mentions-legales", label: "Mentions" },
  { href: "/cgv", label: "CGV" },
  { href: "/confidentialite", label: "Confidentialité" },
  { href: "/cgu", label: "CGU" },
  { href: "/cookies", label: "Cookies" },
  { href: "/guide", label: "Guide" },
  { href: "/feedback", label: "Avis" },
  { href: "/signalement", label: "Signalement" },
] as const;

export function Footer() {
  return (
    <footer className="mt-auto border-t border-[var(--hairline)] bg-[color-mix(in_oklab,var(--background-deep)_45%,var(--background))]">
      <div className="mx-auto flex min-h-16 max-w-6xl flex-col items-start justify-center gap-3 px-5 py-6 text-sm text-[var(--muted)] sm:px-6 md:flex-row md:items-center md:justify-between md:py-0">
        <p className="flex items-center gap-2 tracking-[-0.01em]">
          <span className="font-display text-base leading-none text-[var(--foreground)]">
            {siteConfig.name}
          </span>
          <span aria-hidden className="h-3 w-px bg-[var(--border-strong)]" />
          <span className="font-mono text-[11px] tabular-nums">
            &copy; {new Date().getFullYear()}
          </span>
        </p>
        <nav
          aria-label="Liens légaux"
          className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs md:text-[13px]"
        >
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-[var(--radius-sm)] px-1.5 py-1 transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] hover:text-[var(--foreground)]"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
