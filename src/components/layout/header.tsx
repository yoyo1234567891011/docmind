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
  DashboardIcon,
  FolderIcon,
  HistoryIcon,
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
  { href: "/feedback", label: "Feedback", icon: HistoryIcon },
  { href: "/admin", label: "Admin", icon: SettingsIcon, adminOnly: true },
];

export function Header() {
  const pathname = usePathname();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    void fetchMe()
      .then((data) => setIsAdmin(Boolean(data.user?.isAdmin)))
      .catch(() => setIsAdmin(false));
  }, []);

  const navItems = baseNav.filter((item) => !item.adminOnly || isAdmin);

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)]/80 bg-[color-mix(in_oklab,var(--background)_82%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-6">
        <Link
          href="/dashboard"
          className="group flex items-center gap-2.5 transition-opacity hover:opacity-90"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)]">
            <AnalyzeIcon className="h-4 w-4" />
          </span>
          <span className="font-display text-xl tracking-tight text-[var(--foreground)]">
            {siteConfig.name}
          </span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          <nav className="flex items-center gap-1 overflow-x-auto">
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
                    "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors duration-200",
                    active
                      ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]",
                  )}
                >
                  <Icon className="hidden h-4 w-4 sm:block" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <NotificationCenter />
          <UserMenu />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
