"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { fetchAdminProduction } from "@/lib/client/admin";
import { Alert, Button, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ProductionDashboard } from "@/types/production";

function fmtPct(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

function fmtMs(ms: number): string {
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${ms} ms`;
}

function fmtEur(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function Gauge({
  label,
  value,
  display,
  tone = "default",
}: {
  label: string;
  value: number | null;
  display: string;
  tone?: "default" | "ok" | "warn" | "bad";
}) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-[var(--muted)]">{label}</p>
        <p
          className={cn(
            "font-display text-xl",
            tone === "ok" && "text-[var(--success)]",
            tone === "warn" && "text-[var(--warning)]",
            tone === "bad" && "text-[var(--danger)]",
          )}
        >
          {display}
        </p>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--surface)]">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            tone === "bad"
              ? "bg-[var(--danger)]"
              : tone === "warn"
                ? "bg-[var(--warning)]"
                : "bg-[var(--accent)]",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "ok" | "warn" | "bad";
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p
        className={cn(
          "mt-1 font-display text-2xl tracking-tight",
          tone === "ok" && "text-[var(--success)]",
          tone === "warn" && "text-[var(--warning)]",
          tone === "bad" && "text-[var(--danger)]",
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[11px] text-[var(--muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="font-display text-sm tracking-wide text-[var(--muted)] uppercase">
        {title}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

function resourceTone(pct: number | null): "ok" | "warn" | "bad" | "default" {
  if (pct == null) return "default";
  if (pct >= 90) return "bad";
  if (pct >= 75) return "warn";
  return "ok";
}

export function ProductionDashboardPanel() {
  const [data, setData] = useState<ProductionDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const next = await fetchAdminProduction();
      setData(next);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Impossible de charger le dashboard production",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  if (error && !data) {
    return (
      <Alert tone="error" title="Erreur">
        {error}{" "}
        <Button type="button" size="sm" className="ml-2" onClick={() => void load()}>
          Réessayer
        </Button>
      </Alert>
    );
  }

  if (!data) return null;

  const successTone =
    data.reliability.successRate >= 0.95
      ? "ok"
      : data.reliability.successRate >= 0.8
        ? "warn"
        : "bad";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl">Dashboard production</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Analyses, latences, infra et revenus — fenêtre{" "}
            {data.window.analysisHours}h / business {data.window.businessDays}j.
            Rafraîchi toutes les 30s.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-[var(--muted)]">
            {new Date(data.at).toLocaleString("fr-FR")}
            {data.alertsOpen > 0
              ? ` · ${data.alertsOpen} alerte${data.alertsOpen > 1 ? "s" : ""}`
              : ""}
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={refreshing}
            onClick={() => void load(true)}
          >
            {refreshing ? "…" : "Actualiser"}
          </Button>
        </div>
      </div>

      {error ? (
        <Alert tone="info" title="Actualisation">
          {error}
        </Alert>
      ) : null}

      <Section title="Analyses">
        <Stat
          label="Analyses / min"
          value={String(data.throughput.analysesPerMin)}
          hint={`${data.throughput.analyses1h} sur 1h · ${data.throughput.analyses24h} / 24h`}
        />
        <Stat
          label="Succès"
          value={String(data.reliability.success)}
          hint={fmtPct(data.reliability.successRate)}
          tone={successTone}
        />
        <Stat
          label="Erreurs"
          value={String(data.reliability.errors)}
          hint={`${data.reliability.serverErrors24h} erreurs 5xx`}
          tone={data.reliability.errors > 0 ? "warn" : "ok"}
        />
        <Stat
          label="Cache hit"
          value={fmtPct(data.cache.hitRate)}
          hint={`${data.cache.hits}/${data.cache.totalWithSource || "—"} avec source`}
        />
      </Section>

      <Section title="Latence">
        <Stat label="P50" value={fmtMs(data.latency.p50Ms)} />
        <Stat label="P95" value={fmtMs(data.latency.p95Ms)} />
        <Stat label="P99" value={fmtMs(data.latency.p99Ms)} />
        <Stat
          label="Queue"
          value={fmtMs(data.queue.avgWaitMs)}
          hint={`${data.queue.activeGenerations} génération(s) active(s)`}
        />
      </Section>

      <Section title="Infra">
        <Gauge
          label="GPU usage"
          value={data.host.gpuPercent ?? data.ollama.gpuProxyPercent}
          display={
            data.host.gpuPercent != null
              ? `${data.host.gpuPercent}%`
              : data.ollama.gpuProxyPercent != null
                ? `${data.ollama.gpuProxyPercent}%*`
                : "n/a"
          }
          tone={resourceTone(
            data.host.gpuPercent ?? data.ollama.gpuProxyPercent,
          )}
        />
        <Gauge
          label="VRAM"
          value={data.host.vramPercent}
          display={
            data.host.vramUsedMb != null && data.host.vramTotalMb != null
              ? `${data.host.vramUsedMb}/${data.host.vramTotalMb} Mo`
              : "n/a"
          }
          tone={resourceTone(data.host.vramPercent)}
        />
        <Gauge
          label="CPU"
          value={data.host.cpuPercent}
          display={
            data.host.cpuPercent == null ? "…" : `${data.host.cpuPercent}%`
          }
          tone={resourceTone(data.host.cpuPercent)}
        />
        <Gauge
          label="RAM"
          value={data.host.ramPercent}
          display={`${data.host.ramUsedMb}/${data.host.ramTotalMb} Mo`}
          tone={resourceTone(data.host.ramPercent)}
        />
      </Section>

      <p className="text-[11px] text-[var(--muted)]">
        Ollama {data.ollama.up ? "up" : "down"}
        {data.ollama.model ? ` · ${data.ollama.model}` : ""}
        {data.host.gpuPercent == null && data.ollama.gpuProxyPercent != null
          ? " · * proxy Ollama /api/ps (installez nvidia-smi pour le GPU réel)"
          : ` · host ${data.host.source}`}
      </p>

      <Section title="Business">
        <Stat
          label="Stripe"
          value={data.stripe.label}
          hint={
            data.stripe.webhookConfigured
              ? "Webhook secret OK"
              : "Webhook secret manquant"
          }
          tone={
            data.stripe.status === "ok"
              ? "ok"
              : data.stripe.status === "partial"
                ? "warn"
                : "bad"
          }
        />
        <Stat
          label="Utilisateurs actifs"
          value={String(data.users.active24h)}
          hint={`${data.users.active7d} / 7j · ${data.users.signups30d} inscriptions / 30j`}
        />
        <Stat
          label="Revenus (30j est.)"
          value={fmtEur(data.revenue.estimatedRevenue30dEur)}
          hint={`${data.funnel.converted} conversions · ${data.funnel.renewed} renouvellements`}
        />
        <Stat
          label="MRR"
          value={fmtEur(data.revenue.mrrEur)}
          hint={`${data.users.premiumActive} Premium · ARPU ${fmtEur(data.revenue.arpuEur)}`}
        />
        <Stat
          label="Churn"
          value={fmtPct(data.funnel.churnRate)}
          hint={`${data.funnel.churned} churn · ${data.funnel.cancelRequested} annulations demandées`}
          tone={
            data.funnel.churnRate >= 0.1
              ? "bad"
              : data.funnel.churnRate >= 0.05
                ? "warn"
                : "ok"
          }
        />
        <Stat
          label="Conversion"
          value={fmtPct(data.funnel.conversionRate)}
          hint={`${data.funnel.converted}/${data.funnel.checkoutStarted} checkouts`}
          tone={data.funnel.conversionRate >= 0.2 ? "ok" : "default"}
        />
        <Stat
          label="Premium actifs"
          value={String(data.users.premiumActive)}
          hint={
            data.users.premiumCanceling > 0
              ? `${data.users.premiumCanceling} en fin de période`
              : `source ${data.revenue.billingSource}`
          }
        />
        <Stat
          label="Prix catalogue"
          value={fmtEur(data.revenue.priceMonthlyEur)}
          hint="/ mois Premium"
        />
      </Section>
    </div>
  );
}
