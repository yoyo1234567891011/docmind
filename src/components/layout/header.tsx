"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { NotificationCenter } from "@/components/alerts";
import { UserMenu } from "@/components/auth";
import { ThemeToggle } from "@/components/theme";
import {
  AnalyzeIcon,
  BillingIcon,
  CloseIcon,
  DashboardIcon,
  FolderIcon,
  GuideIcon,
  HistoryIcon,
  MenuIcon,
  SearchIcon,
  SettingsIcon,
} from "@/components/ui/icons";
import { siteConfig } from "@/config/site";
import { fetchMe } from "@/lib/client";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: typeof DashboardIcon;
  adminOnly?: boolean;
};

const baseNav: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { href: "/abonnements", label: "Abonnements", icon: BillingIcon },
  { href: "/analyser", label: "Analyser", icon: AnalyzeIcon },
  { href: "/recherche", label: "Recherche", icon: SearchIcon },
  { href: "/documents", label: "Documents", icon: FolderIcon },
  { href: "/facturation", label: "Facturation", icon: BillingIcon },
  { href: "/feedback", label: "Avis", icon: HistoryIcon },
  { href: "/guide", label: "Guide", icon: GuideIcon },
  { href: "/admin", label: "Admin", icon: SettingsIcon, adminOnly: true },
];

export function Header() {
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    void fetchMe()
      .then((data) => {
        setIsAdmin(Boolean(data.user?.isAdmin));
        setIsSignedIn(Boolean(data.user?.email));
      })
      .catch(() => {
        setIsAdmin(false);
        setIsSignedIn(false);
      });
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  const navItems = baseNav.filter((item) => !item.adminOnly || isAdmin);

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)]/80 bg-[color-mix(in_oklab,var(--background)_82%,transparent)] backdrop-blur-xl">
      {/*
        Desktop (xl ≥1280) : [logo] [onglets texte, sans scroll] [actions]
        Mobile / tablette (&lt;1280) : [logo] …… [actions + hamburger] + panneau vertical
        Pas de overflow-x / barre de glissement sur les onglets.
      */}
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6 xl:gap-5">
        <Link
          href="/dashboard"
          className="relative z-10 flex shrink-0 items-center gap-2.5 transition-opacity hover:opacity-90"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)]">
            <AnalyzeIcon className="h-4 w-4" />
          </span>
          <span className="font-display text-xl tracking-tight text-[var(--foreground)]">
            {siteConfig.name}
          </span>
        </Link>

        <nav
          className="hidden min-w-0 flex-1 items-center gap-x-0.5 xl:flex"
          aria-label="Navigation principale"
        >
          {navItems.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-sm transition-colors duration-200",
                  active
                    ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                    : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="relative z-10 ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2 xl:ml-0">
          <NotificationCenter />
          <UserMenu />
          <ThemeToggle />
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-[var(--foreground)] hover:bg-[var(--surface)] xl:hidden"
            aria-label={menuOpen ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={menuOpen}
            aria-controls="app-mobile-nav"
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
        <div className="border-t border-[var(--border)]/80 bg-[var(--background)] xl:hidden">
          <nav
            id="app-mobile-nav"
            aria-label="Navigation mobile"
            className="mx-auto flex max-h-[min(75vh,32rem)] max-w-6xl flex-col gap-0.5 overflow-y-auto px-3 py-3"
          >
            {navItems.map((item) => {
              const active =
                pathname === item.href ||
                pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex min-h-12 items-center gap-3 rounded-lg px-3 py-3 text-base transition-colors",
                    active
                      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "text-[var(--foreground)] hover:bg-[var(--surface)]",
                  )}
                  onClick={() => setMenuOpen(false)}
                >
                  <Icon className="h-5 w-5 shrink-0 opacity-80" />
                  {item.label}
                </Link>
              );
            })}
            {!isSignedIn ? (
              <div className="mt-2 flex flex-col gap-1 border-t border-[var(--border)] pt-2">
                <Link
                  href="/auth/login"
                  className="inline-flex min-h-12 items-center rounded-lg px-3 py-3 text-base text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
                  onClick={() => setMenuOpen(false)}
                >
                  Connexion
                </Link>
                <Link
                  href="/auth/signup"
                  className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--accent)] px-3 py-3 text-base font-medium text-[var(--accent-foreground)]"
                  onClick={() => setMenuOpen(false)}
                >
                  S&apos;inscrire
                </Link>
              </div>
            ) : null}
          </nav>
        </div>
      ) : null}
    </header>
  );
}
