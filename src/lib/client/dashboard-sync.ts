/**
 * Synchronisation légère du tableau de bord après mutations documents.
 * Pas de polling — flag session + event in-tab + pageshow/focus.
 */

const STALE_KEY = "docmind:dashboard:stale";
const EVENT = "docmind:dashboard:refresh";

export type DashboardRefreshDetail = {
  reason: "manual" | "delete" | "analysis" | "focus" | "patch";
  at: number;
};

export function markDashboardStale(reason: DashboardRefreshDetail["reason"] = "delete"): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STALE_KEY, JSON.stringify({ reason, at: Date.now() }));
  } catch {
    /* private mode */
  }
  window.dispatchEvent(
    new CustomEvent<DashboardRefreshDetail>(EVENT, {
      detail: { reason, at: Date.now() },
    }),
  );
}

export function consumeDashboardStale(): DashboardRefreshDetail | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STALE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STALE_KEY);
    return JSON.parse(raw) as DashboardRefreshDetail;
  } catch {
    return null;
  }
}

export function isDashboardStale(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(sessionStorage.getItem(STALE_KEY));
  } catch {
    return false;
  }
}

export function onDashboardRefresh(
  handler: (detail: DashboardRefreshDetail) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<DashboardRefreshDetail>).detail;
    handler(detail ?? { reason: "manual", at: Date.now() });
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
