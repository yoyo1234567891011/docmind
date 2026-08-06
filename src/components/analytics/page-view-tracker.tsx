"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { trackClientAnalytics } from "@/lib/client/analytics";
import { sanitizeAnalyticsPathname } from "@/lib/analytics-pathname";

/**
 * Émet page.view à chaque navigation client (sans query string).
 */
export function PageViewTracker() {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    const path = sanitizeAnalyticsPathname(pathname);
    if (!path || path === lastPath.current) return;
    lastPath.current = path;
    void trackClientAnalytics("page.view", {
      pathname: path,
      source: "app_router",
    });
  }, [pathname]);

  return null;
}
