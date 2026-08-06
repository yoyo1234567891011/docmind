"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { BetaBanner } from "@/components/beta";
import { Footer, Header } from "@/components/layout";

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAuth = pathname.startsWith("/auth");
  const isMaintenance = pathname.startsWith("/maintenance");
  const isLanding = pathname === "/";

  if (isAuth || isMaintenance || isLanding) {
    return <>{children}</>;
  }

  return (
    <div className="relative flex min-h-screen flex-col">
      <BetaBanner />
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
