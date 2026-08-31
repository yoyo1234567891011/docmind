"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { SpinnerIcon } from "@/components/ui/icons";
import {
  fetchBilling,
  syncBilling,
  type BillingApiResponse,
} from "@/lib/client";
import { formatDateTime } from "@/lib/format";
import { formatClientNetworkError } from "@/lib/client/network-error";
import { cn } from "@/lib/utils";

function badgeClass(tone: string): string {
  switch (tone) {
    case "success":
      return "bg-[var(--accent-soft)] text-[var(--accent)]";
    case "info":
      return "bg-[var(--surface-elevated)] text-[var(--foreground)]";
    case "warning":
      return "bg-[var(--warning-soft)] text-[var(--warning)]";
    case "danger":
      return "bg-[var(--danger-soft)] text-[var(--danger)]";
    default:
      return "bg-[var(--surface-elevated)] text-[var(--muted)]";
  }
}

export function SubscriptionCard({
  refreshKey = 0,
}: {
  refreshKey?: number;
}) {
  const [data, setData] = useState<BillingApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchBilling());
    } catch (e) {
      setError(formatClientNetworkError(e, "Facturation indisponible"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (loading && !data) {
    return (
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <SpinnerIcon className="h-4 w-4" />
          Chargement abonnement…
        </div>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <p className="text-sm text-[var(--muted)]">
          {error || "Abonnement indisponible."}{" "}
          <Link href="/facturation" className="text-[var(--accent)] hover:underline">
            Facturation
          </Link>
        </p>
      </section>
    );
  }

  const { subscription, plan, isPremium, accessBadge } = data;
  const renewalLabel = subscription.cancelAtPeriodEnd
    ? "Fin d’accès"
    : "Renouvellement";

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-left">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
            Abonnement
          </p>
          <p className="mt-1 font-display text-2xl">{plan.name}</p>
        </div>
        <span
          className={cn(
            "inline-flex rounded-full px-3 py-1 text-xs font-semibold",
            badgeClass(accessBadge.tone),
          )}
        >
          {accessBadge.label}
        </span>
      </div>

      <dl className="mt-4 grid gap-2 text-sm md:grid-cols-2">
        <div>
          <dt className="text-xs text-[var(--muted)]">Plan payant</dt>
          <dd>{isPremium ? "Oui" : "Non"}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)]">Statut Stripe</dt>
          <dd>
            <code className="rounded bg-[var(--surface-elevated)] px-1.5 py-0.5 text-xs">
              {subscription.status}
            </code>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)]">{renewalLabel}</dt>
          <dd>
            {subscription.currentPeriodEnd
              ? formatDateTime(subscription.currentPeriodEnd)
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)]">Annulation demandée</dt>
          <dd>
            {subscription.canceledAt
              ? formatDateTime(subscription.canceledAt)
              : "—"}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/facturation"
          className="inline-flex h-9 items-center rounded-lg bg-[var(--accent)] px-3 text-sm font-medium text-[var(--accent-foreground)] hover:bg-[var(--accent-hover)]"
        >
          Gérer l’abonnement
        </Link>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            void (async () => {
              setLoading(true);
              setError(null);
              try {
                setData(await syncBilling());
              } catch (e) {
                setError(
                  formatClientNetworkError(e, "Synchronisation impossible"),
                );
              } finally {
                setLoading(false);
              }
            })();
          }}
        >
          Actualiser
        </Button>
      </div>
    </section>
  );
}
