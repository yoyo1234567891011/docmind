"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui";
import { BellIcon } from "@/components/ui/icons";
import {
  dismissAlerts,
  fetchAlerts,
  markAlertsAsRead,
  markAllAlertsAsRead,
} from "@/lib/client";
import { cn } from "@/lib/utils";
import {
  ALERT_KIND_LABELS,
  type AlertKind,
  type DocumentAlert,
} from "@/types";

function severityClass(severity: DocumentAlert["severity"]) {
  switch (severity) {
    case "critical":
      return "text-[var(--danger)] bg-[var(--danger-soft)]";
    case "warning":
      return "text-[var(--warning)] bg-[var(--warning-soft)]";
    default:
      return "text-[var(--accent)] bg-[var(--accent-soft)]";
  }
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<DocumentAlert[]>([]);
  const [unread, setUnread] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) setIsLoading(true);
    try {
      const data = await fetchAlerts();
      setAlerts(data.alerts.slice(0, 8));
      setUnread(data.summary.unread);
    } catch {
      // Keep previous state on transient errors
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load({ silent: true });

    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void load({ silent: true });
    };

    const timer = window.setInterval(tick, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void load({ silent: true });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleOpen = async () => {
    const next = !open;
    setOpen(next);
    if (!next) return;

    setIsLoading(true);
    try {
      const data = await fetchAlerts();
      setAlerts(data.alerts.slice(0, 8));
      setUnread(data.summary.unread);

      const unreadIds = data.alerts
        .filter((alert) => !alert.read)
        .map((alert) => alert.id);
      if (unreadIds.length > 0) {
        await markAlertsAsRead(unreadIds);
        setUnread(0);
        setAlerts(
          data.alerts.slice(0, 8).map((alert) => ({ ...alert, read: true })),
        );
      }
    } catch {
      // keep previous
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Centre de notifications"
        aria-expanded={open}
        onClick={() => {
          void handleOpen();
        }}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--foreground)]"
      >
        <BellIcon className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-md bg-[var(--danger)] px-1 text-[10px] font-medium text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)] animate-fade-in">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <div>
              <p className="text-sm font-medium text-[var(--foreground)]">
                Notifications
              </p>
              <p className="text-xs text-[var(--muted)]">
                {isLoading
                  ? "Actualisation…"
                  : `${alerts.length} notification${alerts.length > 1 ? "s" : ""}`}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void markAllAlertsAsRead().then(() => {
                  setUnread(0);
                  setAlerts((current) =>
                    current.map((alert) => ({ ...alert, read: true })),
                  );
                });
              }}
            >
              Tout lu
            </Button>
          </div>

          <ul className="max-h-80 overflow-y-auto">
            {alerts.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                Aucune notification pour le moment.
              </li>
            ) : (
              alerts.map((alert) => (
                <li
                  key={alert.id}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <div className="flex gap-3 px-4 py-3">
                    <span
                      className={cn(
                        "mt-0.5 h-2 w-2 shrink-0 rounded-sm",
                        alert.severity === "critical" && "bg-[var(--danger)]",
                        alert.severity === "warning" && "bg-[var(--warning)]",
                        alert.severity === "info" && "bg-[var(--accent)]",
                      )}
                    />
                    <div className="min-w-0 flex-1 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-[var(--foreground)]">
                          {alert.title}
                        </p>
                        <span
                          className={cn(
                            "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                            severityClass(alert.severity),
                          )}
                        >
                          {ALERT_KIND_LABELS[alert.kind as AlertKind]}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--muted)]">
                        {alert.message}
                      </p>
                      <p className="mt-1 text-[11px] text-[var(--muted)]">
                        {alert.date} · {alert.documentTitle}
                      </p>
                      {alert.recommendedAction ? (
                        <p className="mt-1 line-clamp-2 text-[11px] text-[var(--foreground)]">
                          → {alert.recommendedAction}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Link
                          href={`/historique/${alert.historyId}`}
                          className="text-xs font-medium text-[var(--accent)] hover:underline"
                          onClick={() => setOpen(false)}
                        >
                          Voir le document
                        </Link>
                        {alert.secondaryHistoryId ? (
                          <Link
                            href={`/historique/${alert.secondaryHistoryId}`}
                            className="text-xs font-medium text-[var(--muted)] hover:underline"
                            onClick={() => setOpen(false)}
                          >
                            Document lié
                          </Link>
                        ) : null}
                        <button
                          type="button"
                          className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
                          onClick={() => {
                            void dismissAlerts([alert.id]).then(() => {
                              setAlerts((current) =>
                                current.filter((item) => item.id !== alert.id),
                              );
                            });
                          }}
                        >
                          Ignorer
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>

          <div className="border-t border-[var(--border)] px-4 py-3">
            <Link
              href="/alertes"
              onClick={() => setOpen(false)}
              className="text-sm font-medium text-[var(--accent)] hover:underline"
            >
              Voir toutes les notifications
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
