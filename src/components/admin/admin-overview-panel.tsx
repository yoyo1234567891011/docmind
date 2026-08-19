"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchAdminOverview } from "@/lib/client/admin";
import { Alert, Button, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { AdminPlatformOverview } from "@/types/admin-platform";

function fmtNum(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n);
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

function Gauge({
  label,
  value,
  max,
  hint,
}: {
  label: string;
  value: number;
  max: number;
  hint?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const tone = pct >= 90 ? "bad" : pct >= 70 ? "warn" : "ok";
  return (
    <div className="rounded-xl border border-[var(--border)] p-4 sm:col-span-2">
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
          {fmtNum(value)} / {fmtNum(max)} ({pct}%)
        </p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface)]">
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
      {hint ? (
        <p className="mt-2 text-[11px] text-[var(--muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  groq: "Groq (cloud)",
  mistral: "Mistral (cloud)",
  openai_compatible: "API compatible OpenAI",
  ollama: "Ollama (local)",
};

export function AdminOverviewPanel() {
  const [data, setData] = useState<AdminPlatformOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchAdminOverview());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Impossible de charger l'aperçu",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <Alert tone="error" title="Erreur">
        <p>{error}</p>
        <Button type="button" variant="secondary" className="mt-3" onClick={() => void load()}>
          Réessayer
        </Button>
      </Alert>
    );
  }

  if (!data) return null;

  const tokenTone =
    data.tokens.limitPerDay > 0 &&
    data.tokens.usedToday / data.tokens.limitPerDay >= 0.85
      ? "bad"
      : data.tokens.limitPerDay > 0 &&
          data.tokens.usedToday / data.tokens.limitPerDay >= 0.6
        ? "warn"
        : "ok";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--muted)]">
            Mise à jour : {new Date(data.at).toLocaleString("fr-FR")}
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => void load()}>
          Rafraîchir
        </Button>
      </div>

      <section className="space-y-3">
        <h3 className="font-display text-sm uppercase tracking-wide text-[var(--muted)]">
          IA & configuration
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Provider"
            value={PROVIDER_LABELS[data.llm.provider] ?? data.llm.provider}
          />
          <Stat label="Modèle actif" value={data.llm.model} />
          <Stat
            label="Mode"
            value={data.llm.cloudEnabled ? "Cloud (prod)" : "Local (dev)"}
            tone={data.llm.cloudEnabled ? "ok" : "warn"}
          />
          <Stat
            label="Stockage"
            value={data.health.storageMode === "persistent" ? "PostgreSQL + S3" : "Fichiers locaux"}
          />
        </div>
        <p className="text-[11px] text-[var(--muted)]">
          Modèle configuré via <code className="text-xs">LLM_MODEL</code> sur Vercel.
          Pour changer de modèle Groq, modifiez la variable d&apos;environnement puis redéployez.
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-sm uppercase tracking-wide text-[var(--muted)]">
          Tokens Groq (aujourd&apos;hui)
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.tokens.limitPerDay > 0 ? (
            <Gauge
              label="Consommation journalière"
              value={data.tokens.usedToday}
              max={data.tokens.limitPerDay}
              hint={
                data.tokens.source === "estimate"
                  ? "Estimation (~4 000 tokens/analyse). Les prochaines analyses afficheront les valeurs réelles."
                  : "Valeurs mesurées depuis les jobs d'analyse."
              }
            />
          ) : (
            <Stat label="Tokens aujourd'hui" value={fmtNum(data.tokens.usedToday)} />
          )}
          <Stat
            label="Tokens ce mois"
            value={fmtNum(data.tokens.usedMonth)}
            hint={data.tokens.source === "estimate" ? "Estimation" : "Mesuré"}
          />
          <Stat
            label="Moyenne / analyse"
            value={`~${fmtNum(data.tokens.avgPerAnalysis)}`}
          />
          <Stat
            label="Analyses restantes (estim.)"
            value={String(data.tokens.estimatedAnalysesRemainingToday)}
            tone={tokenTone}
            hint="Avant d'atteindre la limite Groq free (200k tokens/jour)"
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-sm uppercase tracking-wide text-[var(--muted)]">
          Utilisateurs
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Comptes ayant utilisé DocMind"
            value={String(data.users.totalEver)}
            hint="Union usage + abonnements + historique"
          />
          <Stat label="Actifs (24h)" value={String(data.users.active24h)} />
          <Stat
            label="Actifs (7j)"
            value={String(data.users.active7d)}
            hint={`${data.users.active30d} sur 30 jours`}
          />
          <Stat
            label="Premium actifs"
            value={String(data.users.premiumActive)}
            tone={data.users.premiumActive > 0 ? "ok" : "default"}
          />
          <Stat
            label="Avec au moins 1 analyse"
            value={String(data.users.withAnalyses)}
          />
          <Stat
            label="Moyenne analyses / user"
            value={String(data.users.avgAnalysesPerUser)}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-sm uppercase tracking-wide text-[var(--muted)]">
          Analyses & file d&apos;attente
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total analyses" value={String(data.analyses.total)} />
          <Stat
            label="Complétées"
            value={String(data.analyses.completed)}
            tone="ok"
          />
          <Stat
            label="Échouées"
            value={String(data.analyses.failed)}
            tone={data.analyses.failed > 0 ? "warn" : "default"}
          />
          <Stat label="Aujourd'hui" value={String(data.analyses.today)} />
          <Stat
            label="En attente (pending)"
            value={String(data.jobs.queuePending)}
            tone={data.jobs.queuePending > 0 ? "warn" : "default"}
          />
          <Stat
            label="En cours (processing)"
            value={String(data.jobs.queueProcessing)}
          />
          <Stat
            label="Durée moyenne P2"
            value={
              data.analyses.avgDurationSec > 0
                ? `${data.analyses.avgDurationSec}s`
                : "—"
            }
          />
          <Stat
            label="Cron drain"
            value={data.health.cronConfigured ? "Configuré" : "Manquant"}
            tone={data.health.cronConfigured ? "ok" : "bad"}
            hint={
              data.health.cronConfigured
                ? "cron-job.org → POST /api/cron/drain-analysis-jobs"
                : "CRON_SECRET absent — les jobs P2 ne seront pas traités"
            }
          />
        </div>
      </section>
    </div>
  );
}
