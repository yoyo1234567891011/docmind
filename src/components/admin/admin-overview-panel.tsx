"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchAdminOverview } from "@/lib/client/admin";
import { BILLING_PLANS } from "@/config/billing";
import { Alert, Button, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { AdminNdNumber, AdminPlatformOverview } from "@/types/admin-platform";

const AUTO_REFRESH_MS = 20_000;

function fmtNum(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n);
}

function fmtNd(n: AdminNdNumber): string {
  if (n.value == null) return "n/d";
  return fmtNum(n.value);
}

function fmtCountdownTo(iso: string, nowMs = Date.now()): string {
  const ms = Math.max(0, new Date(iso).getTime() - nowMs);
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m} min`;
  return `${h} h ${m.toString().padStart(2, "0")} min`;
}

function fmtResetLocal(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtAgeSec(sec: number | null): string {
  if (sec == null) return "n/d";
  if (sec < 60) return `il y a ${sec}s`;
  if (sec < 3600) return `il y a ${Math.floor(sec / 60)} min`;
  return `il y a ${Math.floor(sec / 3600)} h`;
}

function Stat({
  label,
  value,
  hint,
  tone,
  badge,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "ok" | "warn" | "bad";
  badge?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-[var(--muted)]">{label}</p>
        {badge ? (
          <span className="rounded bg-[var(--warning)]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--warning)]">
            {badge}
          </span>
        ) : null}
      </div>
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
  const [nowTick, setNowTick] = useState(() => Date.now());
  const silentRef = useRef(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) setLoading(true);
    silentRef.current = silent;
    setError(null);
    try {
      setData(await fetchAdminOverview());
      setNowTick(Date.now());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Impossible de charger l'aperçu",
      );
    } finally {
      if (!silent) setLoading(false);
      silentRef.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void load({ silent: true });
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
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
        <Button
          type="button"
          variant="secondary"
          className="mt-3"
          onClick={() => void load()}
        >
          Réessayer
        </Button>
      </Alert>
    );
  }

  if (!data) return null;

  const tokenTone =
    data.tokens.limitPerDay > 0 &&
    data.tokens.usedTodayParis / data.tokens.limitPerDay >= 0.85
      ? "bad"
      : data.tokens.limitPerDay > 0 &&
          data.tokens.usedTodayParis / data.tokens.limitPerDay >= 0.6
        ? "warn"
        : "ok";

  const tokensUnmeasuredToday = data.tokens.jobsUnmeasuredToday > 0;
  const tokensGaugeMisleadingZero =
    tokensUnmeasuredToday && data.tokens.usedTodayParis === 0;

  const stripeBadge =
    data.billing.stripeMode === "test"
      ? "TEST"
      : data.billing.stripeMode === "live"
        ? "LIVE"
        : undefined;

  const failPct =
    data.usage.failRate24h != null
      ? `${Math.round(data.usage.failRate24h * 1000) / 10} %`
      : "n/d";

  const parisClock = new Date(data.at).toLocaleString("fr-FR", {
    timeZone: data.timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--muted)]">
            Fuseau {data.timezone} · snapshot {parisClock}
            {loading ? " · rafraîchissement…" : ""}
          </p>
          <p className="text-[11px] text-[var(--muted)]">
            Auto-refresh {AUTO_REFRESH_MS / 1000}s (presence via last_seen, pas
            websocket)
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void load()}
        >
          Rafraîchir
        </Button>
      </div>

      <section className="space-y-3">
        <h3 className="font-display text-sm uppercase tracking-wide text-[var(--muted)]">
          Alertes & santé
        </h3>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Health"
            value={data.health.ok ? "OK" : "Dégradé"}
            tone={data.health.ok ? "ok" : "bad"}
          />
          <Stat
            label="DB"
            value={data.health.dbOk ? "OK" : "KO"}
            tone={data.health.dbOk ? "ok" : "bad"}
          />
          <Stat
            label="Cron drain (secret)"
            value={data.health.cronConfigured ? "Configuré" : "Manquant"}
            tone={data.health.cronConfigured ? "ok" : "bad"}
            hint="CRON_SECRET présent ≠ drain récent"
          />
          <Stat
            label="Dernier drain (âge)"
            value={fmtAgeSec(data.health.lastDrainAgeSec)}
            tone={
              data.health.lastDrainAgeSec != null &&
              data.health.lastDrainAgeSec > 300
                ? "warn"
                : "default"
            }
            hint={
              data.health.lastDrainAt
                ? `${new Date(data.health.lastDrainAt).toLocaleString("fr-FR", { timeZone: data.timezone })} · ${data.health.lastDrainProcessed ?? "?"} job(s)`
                : "Aucun succès drain journalisé"
            }
          />
          <Stat
            label="Jobs stuck"
            value={String(data.jobs.stuck)}
            tone={data.jobs.stuck > 0 ? "bad" : "ok"}
            hint="pending/processing > 10 min"
          />
          <Stat
            label="Reclaimed stale"
            value={String(data.jobs.reclaimedStale)}
          />
        </div>
        {data.alerts.length > 0 ? (
          <ul className="space-y-2">
            {data.alerts.map((a) => (
              <li key={a.id}>
                <Alert
                  tone={
                    a.severity === "critical"
                      ? "error"
                      : a.severity === "warning"
                        ? "info"
                        : "info"
                  }
                  title={a.code}
                >
                  <p>{a.message}</p>
                </Alert>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--success)]">Aucune alerte active.</p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-sm uppercase tracking-wide text-[var(--muted)]">
          En ligne / connexions
        </h3>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="En ligne maintenant"
            value={fmtNd(data.presence.onlineNow)}
            hint={
              data.presence.onlineNow.reason ??
              "last_seen_at < 5 min (blob presence, throttle ≥60s)"
            }
            tone={
              data.presence.onlineNow.value != null &&
              data.presence.onlineNow.value > 0
                ? "ok"
                : "default"
            }
          />
          <Stat
            label="Connectés aujourd’hui (Paris)"
            value={fmtNd(data.presence.connectedTodayParis)}
            hint={
              data.presence.connectedTodayParis.reason ??
              "last_sign_in Auth ∪ last_seen (jour Paris)"
            }
          />
          <Stat
            label="Inscrits aujourd’hui (Paris)"
            value={fmtNd(data.presence.signedUpTodayParis)}
            hint={
              data.presence.signedUpTodayParis.reason ??
              "Auth created_at jour Europe/Paris"
            }
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-sm uppercase tracking-wide text-[var(--muted)]">
          Utilisateurs (Auth)
        </h3>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Comptes Auth"
            value={fmtNd(data.users.authAccounts)}
            hint={
              data.users.authAccounts.reason ?? "Supabase Auth listUsers"
            }
          />
          <Stat
            label="Avec ≥1 analyse (parmi Auth)"
            value={fmtNd(data.users.withAnalysesAmongAuth)}
            hint={
              data.users.withAnalysesAmongAuth.reason ??
              "Distinct user_id app_history ∩ Auth"
            }
          />
          <Stat
            label="Orphelins history"
            value={fmtNd(data.users.orphanHistoryUsers)}
            tone={
              (data.users.orphanHistoryUsers.value ?? 0) > 0 ? "warn" : "default"
            }
            hint={
              data.users.orphanHistoryUsers.reason ??
              "user_id dans app_history absents d’Auth (comptes supprimés)"
            }
          />
          <Stat
            label="Actifs analyse 24h"
            value={fmtNum(data.users.activeAnalyze24h)}
            hint="Parmi Auth encore présents"
          />
          <Stat
            label="Actifs analyse 7j"
            value={fmtNum(data.users.activeAnalyze7d)}
            hint={`${fmtNum(data.users.activeAnalyze30d)} actifs analyse / 30 j (même filtre Auth)`}
          />
          <Stat
            label="Actifs analyse 30j"
            value={fmtNum(data.users.activeAnalyze30d)}
            hint="Parmi Auth encore présents"
          />
          <Stat
            label="Moy. analyses / user (Auth)"
            value={
              data.users.avgAnalysesPerUserWithHistory != null
                ? String(data.users.avgAnalysesPerUserWithHistory)
                : "n/d"
            }
            hint="Jobs completed Auth / users avec ≥1 analyse Auth"
          />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-sm uppercase tracking-wide text-[var(--muted)]">
            Abonnements
          </h3>
          {stripeBadge ? (
            <span
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                data.billing.stripeMode === "test"
                  ? "bg-[var(--warning)]/15 text-[var(--warning)]"
                  : "bg-[var(--success)]/15 text-[var(--success)]",
              )}
            >
              Stripe {stripeBadge}
            </span>
          ) : (
            <span className="rounded bg-[var(--muted)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--muted)]">
              Stripe n/d
            </span>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Free (jamais souscrit)"
            value={
              data.billing.freeNeverSubscribed != null
                ? fmtNum(data.billing.freeNeverSubscribed)
                : "n/d"
            }
            hint="Auth − users avec sub payante active/trialing"
            badge={stripeBadge}
          />
          <Stat
            label="Payants actifs"
            value={fmtNum(data.billing.paidActive)}
            tone={data.billing.paidActive > 0 ? "ok" : "default"}
            hint="active + trialing (DB app_subscriptions)"
            badge={stripeBadge}
          />
          {data.billing.byPlanActive
            .filter((p) => p.plan !== "free")
            .map((p) => (
              <Stat
                key={p.plan}
                label={`${BILLING_PLANS[p.plan]?.name ?? p.plan} actifs`}
                value={fmtNum(p.count)}
                badge={stripeBadge}
              />
            ))}
          <Stat
            label="past_due"
            value={fmtNum(data.billing.pastDue)}
            tone={data.billing.pastDue > 0 ? "warn" : "default"}
            badge={stripeBadge}
          />
          <Stat
            label="canceled"
            value={fmtNum(data.billing.canceled)}
            badge={stripeBadge}
          />
          <Stat
            label="cancel_at_period_end"
            value={fmtNum(data.billing.cancelAtPeriodEnd)}
            badge={stripeBadge}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-sm uppercase tracking-wide text-[var(--muted)]">
          Usage (jour Paris + fenêtres)
        </h3>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Jobs créés (jour Paris)"
            value={fmtNum(data.analyses.todayParis)}
            hint={`created_at ≥ début jour ${data.timezone} · snapshot ${parisClock}`}
          />
          <Stat
            label="Completed (jour Paris)"
            value={fmtNum(data.usage.jobsCompletedTodayParis)}
            tone="ok"
          />
          <Stat
            label="Failed (jour Paris)"
            value={fmtNum(data.usage.jobsFailedTodayParis)}
            tone={data.usage.jobsFailedTodayParis > 0 ? "warn" : "default"}
          />
          <Stat
            label="Pending / processing"
            value={`${data.usage.jobsPending} / ${data.usage.jobsProcessing}`}
            hint="Live file d’attente"
          />
          <Stat
            label="Completed 7j / 30j"
            value={`${fmtNum(data.usage.jobsCompleted7d)} / ${fmtNum(data.usage.jobsCompleted30d)}`}
          />
          <Stat
            label="Failed 7j"
            value={fmtNum(data.usage.jobsFailed7d)}
            tone={data.usage.jobsFailed7d > 0 ? "warn" : "default"}
          />
          <Stat
            label="Taux échec 24h"
            value={failPct}
            hint="failed / (completed+failed) 24h glissants"
            tone={
              data.usage.failRate24h != null && data.usage.failRate24h > 0.2
                ? "bad"
                : "default"
            }
          />
          <Stat
            label="Uploads (jour Paris)"
            value={fmtNum(data.usage.uploadsTodayParis)}
            hint="app_documents created_at jour Paris"
          />
          <Stat
            label="Quota Free atteint (aujourd’hui)"
            value={
              data.usage.freeQuotaHitTodayParis != null
                ? fmtNum(data.usage.freeQuotaHitTodayParis)
                : "n/d"
            }
            hint={`analyze ≥ ${data.usage.freeAnalyzeLimit} (mois UTC) + maj jour Paris · hors payants`}
          />
          <Stat
            label="Quota Free atteint (mois)"
            value={
              data.usage.freeQuotaHitMonth != null
                ? fmtNum(data.usage.freeQuotaHitMonth)
                : "n/d"
            }
            hint={`analyze ≥ ${data.usage.freeAnalyzeLimit} ce mois UTC · hors payants`}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-sm uppercase tracking-wide text-[var(--muted)]">
          Analyses & durées
        </h3>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Total jobs"
            value={fmtNum(data.analyses.total)}
            hint="All-time app_analysis_jobs"
          />
          <Stat
            label="Complétées"
            value={fmtNum(data.analyses.completed)}
            tone="ok"
          />
          <Stat
            label="Échouées"
            value={fmtNum(data.analyses.failed)}
            tone={data.analyses.failed > 0 ? "warn" : "default"}
          />
          <Stat
            label="Durée wall moy. (7j)"
            value={
              data.analyses.avgWallDurationSec7d != null
                ? `${data.analyses.avgWallDurationSec7d}s`
                : "n/d"
            }
            hint="metrics.totalMs ou completed_at−started_at (job réel)"
          />
          <Stat
            label="Durée LLM moy. (7j)"
            value={
              data.analyses.avgLlmDurationSec7d != null &&
              data.analyses.avgLlmDurationSec7d > 0
                ? `${data.analyses.avgLlmDurationSec7d}s`
                : "n/d"
            }
            hint="metrics.generateMs (ou latencyDiag.llmTotalMs) — n/d seulement si absent"
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-sm uppercase tracking-wide text-[var(--muted)]">
          IA & configuration
        </h3>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
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
            value={
              data.health.storageMode === "persistent"
                ? "PostgreSQL + S3"
                : "Fichiers locaux"
            }
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-sm uppercase tracking-wide text-[var(--muted)]">
          Tokens (mesurés · jour Paris)
        </h3>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {tokensGaugeMisleadingZero ? (
            <Stat
              label="Tokens jour Paris"
              value="n/d"
              tone="warn"
              hint={`${data.tokens.jobsUnmeasuredToday} job(s) completed sans usage mesuré — pas « 0 consommé ». Relancer une analyse après correctif modèle/usage.`}
            />
          ) : data.tokens.limitPerDay > 0 ? (
            <Gauge
              label="Tokens mesurés / plafond configuré"
              value={data.tokens.usedTodayParis}
              max={data.tokens.limitPerDay}
              hint={
                tokensUnmeasuredToday
                  ? `${data.tokens.limitLabel} · ${data.tokens.jobsUnmeasuredToday} job(s) non mesuré(s) exclus`
                  : data.tokens.limitLabel
              }
            />
          ) : (
            <Stat
              label="Tokens jour Paris (mesurés)"
              value={fmtNum(data.tokens.usedTodayParis)}
              hint="Somme metrics.totalTokens > 0"
            />
          )}
          <Stat
            label="Tokens 30 j (mesurés)"
            value={fmtNum(data.tokens.usedMonthRolling30d)}
            hint="Somme metrics.totalTokens > 0, 30 j glissants"
          />
          <Stat
            label="Moyenne / analyse (30 j)"
            value={
              data.tokens.avgPerAnalysis != null
                ? fmtNum(data.tokens.avgPerAnalysis)
                : "non mesuré"
            }
            hint={
              data.tokens.jobsMeasuredMonth > 0
                ? `${data.tokens.jobsMeasuredMonth} job(s) mesuré(s)`
                : "Aucun job avec usage > 0 sur 30 j"
            }
          />
          <Stat
            label="Estim. analyses restantes (plafond configuré)"
            value={
              tokensGaugeMisleadingZero
                ? "n/d"
                : data.tokens.estimatedAnalysesRemainingToday != null
                  ? String(data.tokens.estimatedAnalysesRemainingToday)
                  : "n/d"
            }
            tone={
              tokensGaugeMisleadingZero
                ? "warn"
                : data.tokens.estimatedAnalysesRemainingToday != null
                  ? tokenTone
                  : "default"
            }
            hint={
              tokensGaugeMisleadingZero
                ? "Estimation impossible tant que l’usage du jour n’est pas mesuré"
                : data.tokens.limitSource === "configured_estimate"
                  ? data.tokens.limitLabel
                  : "Pas de plafond (mode local)"
            }
          />
          <Stat
            label="Réinit. plafond (UTC)"
            value={
              data.tokens.limitPerDay > 0
                ? `dans ${fmtCountdownTo(data.tokens.resetsAt, nowTick)}`
                : "—"
            }
            hint={
              data.tokens.limitPerDay > 0
                ? `Minuit ${data.tokens.resetTimezone} → ${fmtResetLocal(data.tokens.resetsAt)}`
                : "Pas de plafond journalier"
            }
          />
          {data.tokens.jobsUnmeasuredToday > 0 ||
          data.tokens.jobsUnmeasuredMonth > 0 ? (
            <Stat
              label="Jobs usage non mesuré"
              value={`${data.tokens.jobsUnmeasuredToday} jour / ${data.tokens.jobsUnmeasuredMonth} (30 j)`}
              tone="warn"
              hint="Completed sans totalTokens > 0 (generate_failed / fallback local) — exclus de la somme"
            />
          ) : null}
        </div>
        <p className="text-[11px] text-[var(--muted)]">
          Somme mesurée depuis les réponses LLM (metrics.totalTokens &gt; 0). Le
          plafond est une estimation configurée — pas le quota officiel de
          l’API provider. Un jauge à 0&nbsp;% n’est affichée que si des tokens
          ont bien été mesurés (sinon n/d).
        </p>
      </section>
    </div>
  );
}
