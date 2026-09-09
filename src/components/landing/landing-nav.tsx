"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CloseIcon, MenuIcon } from "@/components/ui/icons";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "#demo", label: "Exemple" },
  { href: "#pourquoi", label: "vs ChatGPT" },
  { href: "#tarifs", label: "Tarifs" },
  { href: "#faq", label: "FAQ" },
] as const;

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 transition-[background,border-color,backdrop-filter] duration-300",
        scrolled || menuOpen
          ? "border-b border-[var(--border)]/70 bg-[color-mix(in_oklab,var(--background)_88%,transparent)] backdrop-blur-xl"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-6">
        <a
          href="#top"
          className="font-display text-2xl tracking-tight text-[var(--foreground)]"
          onClick={() => setMenuOpen(false)}
        >
          {siteConfig.name}
        </a>

        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/auth/login"
            className="hidden h-9 items-center px-3 text-sm text-[var(--muted)] transition-colors hover:text-[var(--foreground)] sm:inline-flex"
          >
            Connexion
          </Link>
          <Link
            href="/auth/signup"
            className="inline-flex h-9 shrink-0 items-center rounded-md bg-[var(--accent)] px-2.5 text-xs font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)] sm:px-3.5 sm:text-sm"
          >
            <span className="md:hidden">Essayer</span>
            <span className="hidden md:inline">Essayer gratuitement</span>
          </Link>
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--foreground)] hover:bg-[var(--surface)] md:hidden"
            aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? (
              <CloseIcon className="h-5 w-5" />
            ) : (
              <MenuIcon className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {menuOpen ? (
        <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-3 pb-4 md:hidden">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--surface)]"
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <Link
            href="/auth/login"
            className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] sm:hidden"
            onClick={() => setMenuOpen(false)}
          >
            Connexion
          </Link>
        </nav>
      ) : null}
    </header>
  );
}
