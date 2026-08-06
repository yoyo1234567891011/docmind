"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 transition-[background,border-color,backdrop-filter] duration-300",
        scrolled
          ? "border-b border-[var(--border)]/70 bg-[color-mix(in_oklab,var(--background)_88%,transparent)] backdrop-blur-xl"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-6">
        <a
          href="#top"
          className="font-display text-2xl tracking-tight text-[var(--foreground)]"
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

        <div className="flex items-center gap-2">
          <Link
            href="/auth/login"
            className="hidden h-9 items-center px-3 text-sm text-[var(--muted)] transition-colors hover:text-[var(--foreground)] sm:inline-flex"
          >
            Connexion
          </Link>
          <Link
            href="/auth/signup"
            className="inline-flex h-9 items-center rounded-md bg-[var(--accent)] px-3.5 text-sm font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)]"
          >
            Essayer gratuitement
          </Link>
        </div>
      </div>
    </header>
  );
}
