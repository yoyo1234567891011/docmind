"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchAdminJobs, retryAdminJob } from "@/lib/client/admin";
import { Alert, Button, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { AdminJobRow, AdminJobsListResult } from "@/types/admin-ops";

function fmtAge(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

const FILTERS = [
  { id: "all", label: "Tous" },
  { id: "stuck", label: "Stuck >10min" },
  { id: "pending", label: "Pending" },
  { id: "processing", label: "Processing" },
  { id: "failed", label: "Failed" },
  { id: "completed", label: "Completed" },
] as const;

export function AdminJobsPanel() {
  const [filter, setFilter] =
    useState<(typeof FILTERS)[number]["id"]>("stuck");
  const [data, setData] = useState<AdminJobsListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchAdminJobs({ status: filter, limit: 80 });
      setData(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur jobs");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRetry(job: AdminJobRow) {
    setBusyId(job.id);
    setError(null);
    try {
      await retryAdminJob(job.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry échoué");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-lg">File d&apos;analyses P2</h2>
          <p className="text-xs text-[var(--muted)]">
            Sans extract PDF · stuck = pending/processing &gt; 10 min ou lease
            expirée · compteurs = all-time PG
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => void load()}>
          Actualiser
        </Button>
      </div>

      {data ? (
        <div className="grid gap-2 sm:grid-cols-5">
          {(
            [
              ["pending", data.counts.pending],
              ["processing", data.counts.processing],
              ["completed", data.counts.completed],
              ["failed", data.counts.failed],
              ["stuck", data.counts.stuck],
            ] as const
          ).map(([k, v]) => (
            <div
              key={k}
              className="rounded-xl border border-[var(--border)] px-3 py-2"
            >
              <p className="text-[11px] text-[var(--muted)]">{k}</p>
              <p
                className={cn(
                  "font-display text-xl",
                  k === "stuck" && v > 0 && "text-[var(--danger)]",
                  k === "failed" && v > 0 && "text-[var(--warning)]",
                )}
              >
                {v}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              filter === f.id
                ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--muted)]",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {loading && !data ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      {data && data.jobs.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Aucun job pour ce filtre.</p>
      ) : null}

      <ul className="space-y-2">
        {data?.jobs.map((job) => (
          <li
            key={job.id}
            className={cn(
              "rounded-xl border border-[var(--border)] p-3 text-sm",
              job.stuck && "border-[var(--danger)]/40 bg-[var(--danger)]/5",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <p className="font-medium">
                  {job.status}
                  {job.stuck ? " · STUCK" : ""} · {job.fileName}
                </p>
                <p className="break-all text-xs text-[var(--muted)]">
                  {job.userEmail || job.userId} · âge {fmtAge(job.ageMs)} ·
                  attempts {job.attempts}
                </p>
                <p className="break-all text-[11px] text-[var(--muted)]">
                  job {job.id} · history {job.historyId}
                </p>
                {job.lastError ? (
                  <p className="mt-1 text-xs text-[var(--warning)]">
                    {job.lastError}
                  </p>
                ) : null}
              </div>
              {job.status !== "completed" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busyId === job.id}
                  onClick={() => void onRetry(job)}
                >
                  {busyId === job.id ? "…" : "Retry"}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
