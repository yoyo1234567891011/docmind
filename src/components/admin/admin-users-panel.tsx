"use client";

import { useCallback, useEffect, useState } from "react";

import {
  adminResetUserAnalyzeQuota,
  adminSyncUserStripe,
  fetchAdminUserDetail,
  fetchAdminUsers,
  searchAdminUserByEmail,
} from "@/lib/client/admin";
import { Alert, Button, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { AdminUserDetail, AdminUserListItem } from "@/types/admin-ops";

function fmtQuota(q: { used: number; limit: number; remaining: number }): string {
  if (q.limit < 0) return `${q.used}/∞`;
  return `${q.used}/${q.limit} (reste ${q.remaining})`;
}

export function AdminUsersPanel() {
  const [list, setList] = useState<AdminUserListItem[]>([]);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [search, setSearch] = useState("");
  const [confirmReset, setConfirmReset] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminUsers(80);
      setList(data.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  async function openUser(userId: string) {
    setBusy(true);
    setError(null);
    setInfo(null);
    setConfirmReset("");
    try {
      const d = await fetchAdminUserDetail(userId);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fiche impossible");
    } finally {
      setBusy(false);
    }
  }

  async function onSearch() {
    if (!search.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const d = await searchAdminUserByEmail(search.trim());
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recherche échouée");
    } finally {
      setBusy(false);
    }
  }

  async function onSync() {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      const d = await adminSyncUserStripe(detail.userId);
      setDetail(d);
      setInfo("Sync Stripe OK");
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync échouée");
    } finally {
      setBusy(false);
    }
  }

  async function onResetQuota() {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      const d = await adminResetUserAnalyzeQuota(detail.userId, confirmReset);
      setDetail(d);
      setConfirmReset("");
      setInfo("Quota analyze remis à 0 (TEST)");
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset échoué");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-lg">Users</h2>
          <p className="text-xs text-[var(--muted)]">
            Plan stocké vs effectif (past_due → Free) · quotas mois UTC
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => void loadList()}>
          Actualiser
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="email@…"
          className="min-w-[220px] flex-1 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
        />
        <Button type="button" size="sm" disabled={busy} onClick={() => void onSearch()}>
          Chercher
        </Button>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {info ? <Alert tone="success">{info}</Alert> : null}

      {loading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Analyze</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr
                  key={u.userId}
                  className={cn(
                    "border-b border-[var(--border)]/60",
                    detail?.userId === u.userId && "bg-[var(--accent)]/5",
                  )}
                >
                  <td className="px-3 py-2">
                    <div className="max-w-[220px] truncate">
                      {u.email || u.userId.slice(0, 8)}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {u.planStored}
                    {u.planEffective !== u.planStored ? (
                      <span className="text-[var(--warning)]">
                        {" "}
                        → {u.planEffective}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{u.status}</td>
                  <td className="px-3 py-2">{fmtQuota(u.analyze)}</td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void openUser(u.userId)}
                    >
                      Fiche
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail ? (
        <div className="space-y-3 rounded-xl border border-[var(--border)] p-4">
          <h3 className="font-display text-base">Fiche utilisateur</h3>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-[var(--muted)]">Email</dt>
              <dd>{detail.email || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">userId</dt>
              <dd className="break-all text-xs">{detail.userId}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Plan stocké / effectif</dt>
              <dd>
                {detail.planStored} / {detail.planEffective}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Status Stripe</dt>
              <dd>{detail.status}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">period_end</dt>
              <dd>
                {detail.currentPeriodEnd
                  ? new Date(detail.currentPeriodEnd).toLocaleString("fr-FR")
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Pending downgrade</dt>
              <dd>
                {detail.pendingPlan
                  ? `${detail.pendingPlan} @ ${detail.pendingPlanEffectiveAt ?? "?"}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Quotas ({detail.quotasMonth})</dt>
              <dd>
                analyze {fmtQuota(detail.analyze)} · search{" "}
                {fmtQuota(detail.search)} · letter {fmtQuota(detail.letter)}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void onSync()}>
              Sync Stripe
            </Button>
          </div>

          <div className="space-y-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/5 p-3">
            <p className="text-xs text-[var(--muted)]">
              Reset analyze TEST — tapez l&apos;email ou le userId exact pour
              confirmer (pas de reset auto à l&apos;upgrade).
            </p>
            <input
              value={confirmReset}
              onChange={(e) => setConfirmReset(e.target.value)}
              placeholder={detail.email || detail.userId}
              className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy || !confirmReset.trim()}
              onClick={() => void onResetQuota()}
            >
              Reset analyze → 0
            </Button>
          </div>

          <div>
            <h4 className="mb-2 text-xs uppercase tracking-wide text-[var(--muted)]">
              Jobs récents
            </h4>
            {detail.recentJobs.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">Aucun job.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {detail.recentJobs.map((j) => (
                  <li key={j.id} className="rounded border border-[var(--border)] px-2 py-1">
                    {j.status}
                    {j.stuck ? " STUCK" : ""} · {j.fileName}
                    {j.lastError ? ` · ${j.lastError.slice(0, 80)}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
