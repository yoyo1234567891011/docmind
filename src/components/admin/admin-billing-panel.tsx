"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchAdminBilling } from "@/lib/client/admin";
import { Alert, Button, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { AdminBillingDetail } from "@/types/admin-ops";

export function AdminBillingPanel() {
  const [data, setData] = useState<AdminBillingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchAdminBilling());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur billing");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-lg">Billing</h2>
          <p className="text-xs text-[var(--muted)]">
            Répartition plans · past_due · cancel_at_period_end · mode Stripe
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => void load()}>
          Actualiser
        </Button>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {loading && !data ? <Skeleton className="h-40 w-full" /> : null}

      {data ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium",
                data.stripeMode === "live" &&
                  "border-[var(--danger)] text-[var(--danger)]",
                data.stripeMode === "test" &&
                  "border-[var(--success)] text-[var(--success)]",
                data.stripeMode === "unconfigured" &&
                  "border-[var(--warning)] text-[var(--warning)]",
              )}
            >
              Stripe {data.stripeMode.toUpperCase()}
            </span>
            <span className="text-xs text-[var(--muted)]">
              Webhook {data.webhookConfigured ? "configuré" : "manquant"} ·
              source {data.source}
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Payants effectifs" value={String(data.paidActiveEffective)} />
            <Stat label="Free effectifs" value={String(data.freeEffective)} />
            <Stat
              label="past_due"
              value={String(data.pastDue)}
              warn={data.pastDue > 0}
            />
            <Stat
              label="cancel_at_period_end"
              value={String(data.cancelAtPeriodEnd)}
            />
            <Stat
              label="MRR estimé"
              value={`${data.mrrEur.toFixed(2)} €`}
            />
          </div>

          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--border)] text-xs text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2">Plan stocké</th>
                  <th className="px-3 py-2">Comptes</th>
                  <th className="px-3 py-2">dont past_due</th>
                </tr>
              </thead>
              <tbody>
                {data.byPlan.map((row) => (
                  <tr key={row.plan} className="border-b border-[var(--border)]/60">
                    <td className="px-3 py-2">{row.plan}</td>
                    <td className="px-3 py-2">{row.count}</td>
                    <td className="px-3 py-2">{row.effectiveFreeWhilePastDue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-[var(--muted)]">
            past_due : plan catalogue souvent conservé en base ; accès effectif =
            Free via resolveEffectivePlan. MRR n’inclut que les plans effectifs
            payants (active/trialing).
          </p>
        </>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] px-3 py-2">
      <p className="text-[11px] text-[var(--muted)]">{label}</p>
      <p
        className={cn(
          "font-display text-xl",
          warn && "text-[var(--warning)]",
        )}
      >
        {value}
      </p>
    </div>
  );
}
