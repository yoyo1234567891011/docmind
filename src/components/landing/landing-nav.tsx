"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { LandingSectionLink } from "@/components/landing/landing-section-link";
import { AnalyzeIcon, CloseIcon, MenuIcon } from "@/components/ui/icons";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

const LINKS = [
  { sectionId: "demo", label: "Exemple" },
  { sectionId: "pourquoi", label: "vs ChatGPT" },
  { sectionId: "exemples", label: "Cas concrets" },
  { sectionId: "tarifs", label: "Tarifs" },
  { sectionId: "faq", label: "FAQ" },
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
          ? "border-b border-[var(--hairline)] bg-[color-mix(in_oklab,var(--background)_76%,transparent)] backdrop-blur-xl backdrop-saturate-150"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5 sm:px-6">
        <LandingSectionLink
          sectionId="top"
          className="group flex items-center gap-2.5 rounded-[var(--radius-md)]"
          onNavigate={() => setMenuOpen(false)}
        >
          <span
            aria-hidden
            className="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-[0.45rem] bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[inset_0_1px_0_color-mix(in_oklab,white_25%,transparent),var(--shadow-accent)] transition-transform duration-300 ease-[var(--ease-spring)] group-hover:scale-105"
          >
            <span className="absolute inset-0 bg-[linear-gradient(160deg,color-mix(in_oklab,white_22%,transparent),transparent_55%)]" />
            <AnalyzeIcon className="relative h-3.5 w-3.5" />
          </span>
          <span className="font-display text-[1.375rem] leading-none tracking-tight text-[var(--foreground)]">
            {siteConfig.name}
          </span>
        </LandingSectionLink>

        <nav className="hidden items-center gap-px md:flex">
          {LINKS.map((link) => (
            <LandingSectionLink
              key={link.sectionId}
              sectionId={link.sectionId}
              className="rounded-[var(--radius-md)] px-3 py-1.5 text-[13px] tracking-[-0.01em] text-[var(--muted)] transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] hover:text-[var(--foreground)]"
            >
              {link.label}
            </LandingSectionLink>
          ))}
        </nav>

        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/auth/login"
            className="hidden h-9 items-center rounded-[var(--radius-md)] px-3 text-[13px] tracking-[-0.01em] text-[var(--muted)] transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] hover:text-[var(--foreground)] sm:inline-flex"
          >
            Connexion
          </Link>
          <Link
            href="/auth/signup"
            className="inline-flex h-9 shrink-0 items-center rounded-[var(--radius-md)] bg-[var(--accent)] px-2.5 text-xs font-medium tracking-[-0.01em] text-[var(--accent-foreground)] shadow-[inset_0_1px_0_color-mix(in_oklab,white_18%,transparent),var(--shadow-accent)] transition-[background-color,transform] duration-150 hover:bg-[var(--accent-hover)] active:scale-[0.98] sm:px-3.5 sm:text-sm"
          >
            <span className="md:hidden">Essayer</span>
            <span className="hidden md:inline">Essayer gratuitement</span>
          </Link>
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--foreground)] hover:bg-[var(--surface)] md:hidden"
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
        <nav className="animate-fade-in mx-auto flex max-w-6xl flex-col gap-1 border-t border-[var(--hairline)] px-3 pb-4 pt-2 md:hidden">
          {LINKS.map((link) => (
            <LandingSectionLink
              key={link.sectionId}
              sectionId={link.sectionId}
              className="inline-flex min-h-11 items-center rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--surface)]"
              onNavigate={() => setMenuOpen(false)}
            >
              {link.label}
            </LandingSectionLink>
          ))}
          <Link
            href="/auth/login"
            className="inline-flex min-h-11 items-center rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)] sm:hidden"
            onClick={() => setMenuOpen(false)}
          >
            Connexion
          </Link>
        </nav>
      ) : null}
    </header>
  );
}
