"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  compareAdminPrompts,
  deleteAdminPrompt,
  fetchAdminDashboard,
  fetchAdminMonitoring,
  fetchHistory,
  patchAdminConfig,
  reanalyzeAdminDocument,
  rollbackAdminPrompt,
  runAdminMonitoringCheck,
  saveAdminPrompt,
  type AdminDashboardData,
  type AdminMonitoringAlert,
  type AdminMonitoringSnapshot,
} from "@/lib/client";
import { Alert, Button, Skeleton } from "@/components/ui";

const ProductionDashboardPanel = dynamic(
  () =>
    import("@/components/admin/production-dashboard").then((m) => ({
      default: m.ProductionDashboardPanel,
    })),
  {
    loading: () => (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    ),
  },
);

const AdminOverviewPanel = dynamic(
  () =>
    import("@/components/admin/admin-overview-panel").then((m) => ({
      default: m.AdminOverviewPanel,
    })),
  {
    loading: () => (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    ),
  },
);
import type {
  AdminPromptKey,
  AdminPromptVersion,
  AdminRuntimeConfig,
  HistoryListItem,
} from "@/types";
import { cn } from "@/lib/utils";

type TabId =
  | "overview"
  | "production"
  | "models"
  | "prompts"
  | "performance"
  | "monitoring"
  | "product"
  | "errors"
  | "reanalyze"
  | "compare";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Vue d'ensemble" },
  { id: "production", label: "Production" },
  { id: "models", label: "Modèles IA" },
  { id: "prompts", label: "Prompts" },
  { id: "performance", label: "Performances" },
  { id: "monitoring", label: "Monitoring" },
  { id: "product", label: "Produit" },
  { id: "errors", label: "Erreurs" },
  { id: "reanalyze", label: "Re-analyse" },
  { id: "compare", label: "Comparer" },
];

const PROMPT_KEYS: AdminPromptKey[] = [
  "classification",
  "analysis",
  "reply",
  "searchIntent",
];

const TASK_LABELS: Record<string, string> = {
  classify: "Classification",
  analyze: "Analyse",
  reply: "Réponse",
  searchIntent: "Recherche NL",
};

export function AdminPanel() {
  const [tab, setTab] = useState<TabId>("overview");
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [configDraft, setConfigDraft] = useState<AdminRuntimeConfig | null>(
    null,
  );

  const [promptKey, setPromptKey] = useState<AdminPromptKey>("analysis");
  const [editingParentId, setEditingParentId] = useState<string | null>(null);
  const [promptLabel, setPromptLabel] = useState("");
  const [promptContent, setPromptContent] = useState("");

  const [history, setHistory] = useState<HistoryListItem[]>([]);
  const [reanalyzeId, setReanalyzeId] = useState("");
  const [reanalyzeBusy, setReanalyzeBusy] = useState(false);

  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [compareSample, setCompareSample] = useState("");
  const [compareResult, setCompareResult] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [compareBusy, setCompareBusy] = useState(false);

  const [monitoring, setMonitoring] = useState<{
    snapshot: AdminMonitoringSnapshot;
    alerts: AdminMonitoringAlert[];
  } | null>(null);
  const [monitoringBusy, setMonitoringBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchAdminDashboard();
      setData(next);
      setConfigDraft(next.config);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chargement Admin impossible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (tab !== "reanalyze") return;
    void fetchHistory({})
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [tab]);

  useEffect(() => {
    if (tab !== "monitoring") return;
    void fetchAdminMonitoring()
      .then(setMonitoring)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Monitoring indisponible"),
      );
  }, [tab]);

  const versionsForKey = useMemo(() => {
    if (!data) return [];
    return data.prompts.versions
      .filter((v) => v.key === promptKey)
      .sort((a, b) => (b.version || 0) - (a.version || 0));
  }, [data, promptKey]);

  async function saveModels() {
    if (!configDraft) return;
    setSaving(true);
    setMessage(null);
    try {
      const config = await patchAdminConfig({
        ollamaBaseUrl: configDraft.ollamaBaseUrl,
        embedModel: configDraft.embedModel,
        tasks: configDraft.tasks,
      });
      setConfigDraft(config);
      setMessage("Configuration modèles enregistrée (sans redéploiement).");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec sauvegarde");
    } finally {
      setSaving(false);
    }
  }

  async function activatePrompt(versionId: string | null) {
    if (!data) return;
    setSaving(true);
    try {
      await patchAdminConfig({
        activePrompts: {
          ...data.config.activePrompts,
          [promptKey]: versionId,
        },
      });
      setMessage(
        versionId
          ? "Prompt actif mis à jour."
          : "Retour au prompt code (défaut).",
      );
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec activation");
    } finally {
      setSaving(false);
    }
  }

  async function savePrompt() {
    if (!promptLabel.trim() || !promptContent.trim()) return;
    setSaving(true);
    try {
      const version = await saveAdminPrompt({
        key: promptKey,
        label: promptLabel.trim(),
        content: promptContent,
        parentId: editingParentId,
        activate: true,
      });
      setEditingParentId(null);
      setPromptLabel("");
      setPromptContent("");
      setMessage(
        `Nouvelle version v${version.version} créée et activée (immuable).`,
      );
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec enregistrement prompt");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(version: AdminPromptVersion) {
    setEditingParentId(version.id);
    setPromptLabel(`${version.label} → v${version.version + 1}`);
    setPromptContent(version.content);
    setPromptKey(version.key);
  }

  function startFork(version: AdminPromptVersion) {
    setEditingParentId(version.id);
    setPromptLabel(`${version.label} (fork)`);
    setPromptContent(version.content);
    setPromptKey(version.key);
  }

  async function rollback(versionId: string) {
    setSaving(true);
    try {
      const version = await rollbackAdminPrompt(versionId);
      setMessage(
        `Rollback : ${version.key} revient à v${version.version} — ${version.label}`,
      );
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rollback impossible");
    } finally {
      setSaving(false);
    }
  }

  async function removePrompt(id: string) {
    setSaving(true);
    try {
      await deleteAdminPrompt(id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible");
    } finally {
      setSaving(false);
    }
  }

  async function runReanalyze() {
    if (!reanalyzeId) return;
    setReanalyzeBusy(true);
    setMessage(null);
    try {
      const record = await reanalyzeAdminDocument(reanalyzeId, false);
      setMessage(
        `Re-analyse OK — ${record.fileName} · modèle ${record.model} · ${record.analyzedAt}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-analyse échouée");
    } finally {
      setReanalyzeBusy(false);
    }
  }

  async function runCompare(mode: "diff" | "run") {
    if (!compareA || !compareB) return;
    setCompareBusy(true);
    setCompareResult(null);
    try {
      const result = await compareAdminPrompts({
        versionIdA: compareA,
        versionIdB: compareB,
        mode,
        sampleText: compareSample,
        key: promptKey,
      });
      setCompareResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comparaison échouée");
    } finally {
      setCompareBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-tight text-[var(--foreground)]">
            Admin
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            Vue d&apos;ensemble prod (Groq, tokens, utilisateurs), prompts et
            ops — sans redéploiement pour les prompts.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => void reload()}>
          Rafraîchir
        </Button>
      </div>

      {error ? (
        <Alert tone="error" title="Erreur">
          {error}
        </Alert>
      ) : null}
      {message ? (
        <Alert tone="success" title="OK">
          {message}
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-3">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "rounded-lg px-3 py-2 text-sm transition-colors",
              tab === item.id
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" ? <AdminOverviewPanel /> : null}

      {tab === "production" ? <ProductionDashboardPanel /> : null}

      {tab === "models" && configDraft ? (
        <section className="space-y-5">
          {data?.llmRuntime?.cloudEnabled ? (
            <div className="space-y-3 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)]/30 p-4">
              <p className="font-medium">IA cloud (production)</p>
              <p className="text-sm text-[var(--muted)]">
                DocMind utilise{" "}
                <strong>{data.llmRuntime.provider.toUpperCase()}</strong> en
                production. Le modèle actif est{" "}
                <code className="text-xs">{data.llmRuntime.model}</code>.
              </p>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-[var(--muted)]">Provider</dt>
                  <dd>{data.llmRuntime.provider}</dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Modèle</dt>
                  <dd>{data.llmRuntime.model}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-[var(--muted)]">API</dt>
                  <dd className="break-all font-mono text-xs">
                    {data.llmRuntime.baseUrl}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-[var(--muted)]">
                Pour changer de modèle : variable{" "}
                <code className="text-[11px]">LLM_MODEL</code> sur Vercel →
                redéployer. Les réglages Ollama ci-dessous ne s&apos;appliquent
                qu&apos;en développement local.
              </p>
            </div>
          ) : null}

          {data?.modelProfiles ? (
            <div className="space-y-3 rounded-xl border border-[var(--border)] p-4">
              <div>
                <p className="font-medium">Profils Ollama</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Source de vérité :{" "}
                  <code className="text-[11px]">src/config/docmind.ts</code>{" "}
                  (<code className="text-[11px]">ollama.activeProfile</code>=
                  {data.modelProfiles.active}). Appliquer un profil ici met à
                  jour les modèles runtime sans redéployer.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {data.modelProfiles.profiles.map((profile) => {
                  const selected =
                    (configDraft.profileId || data.modelProfiles?.runtime) ===
                    profile.id;
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        void (async () => {
                          setSaving(true);
                          setMessage(null);
                          try {
                            const config = await patchAdminConfig({
                              profileId: profile.id,
                            });
                            setConfigDraft(config);
                            setMessage(
                              `Profil ${profile.label} appliqué (${profile.chat}).`,
                            );
                            await reload();
                          } catch (err) {
                            setError(
                              err instanceof Error
                                ? err.message
                                : "Échec application profil",
                            );
                          } finally {
                            setSaving(false);
                          }
                        })();
                      }}
                      className={cn(
                        "rounded-xl border px-3 py-3 text-left transition-colors",
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                          : "border-[var(--border)] hover:border-[var(--accent)]",
                      )}
                    >
                      <p className="text-sm font-medium">
                        {profile.label}
                        {selected ? (
                          <span className="ml-2 text-xs text-[var(--accent)]">
                            ACTIF
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {profile.chat}
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {profile.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <label className="block space-y-1.5 text-sm">
            <span className="text-[var(--muted)]">URL Ollama</span>
            <input
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
              value={configDraft.ollamaBaseUrl}
              onChange={(e) =>
                setConfigDraft({
                  ...configDraft,
                  ollamaBaseUrl: e.target.value,
                })
              }
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="text-[var(--muted)]">Modèle embeddings</span>
            <input
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
              value={configDraft.embedModel}
              onChange={(e) =>
                setConfigDraft({ ...configDraft, embedModel: e.target.value })
              }
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            {(
              Object.keys(configDraft.tasks) as Array<
                keyof typeof configDraft.tasks
              >
            ).map((task) => (
              <div
                key={task}
                className="space-y-3 rounded-xl border border-[var(--border)] p-4"
              >
                <p className="font-medium">{TASK_LABELS[task] ?? task}</p>
                <label className="block space-y-1 text-sm">
                  <span className="text-[var(--muted)]">Modèle</span>
                  <input
                    list="ollama-models"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                    value={configDraft.tasks[task].model}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        tasks: {
                          ...configDraft.tasks,
                          [task]: {
                            ...configDraft.tasks[task],
                            model: e.target.value,
                          },
                        },
                      })
                    }
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="text-[var(--muted)]">Température</span>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    max={2}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                    value={configDraft.tasks[task].temperature}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        tasks: {
                          ...configDraft.tasks,
                          [task]: {
                            ...configDraft.tasks[task],
                            temperature: Number(e.target.value),
                          },
                        },
                      })
                    }
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="text-[var(--muted)]">Max tokens</span>
                  <input
                    type="number"
                    step={256}
                    min={0}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                    value={configDraft.tasks[task].maxTokens ?? 0}
                    onChange={(e) =>
                      setConfigDraft({
                        ...configDraft,
                        tasks: {
                          ...configDraft.tasks,
                          [task]: {
                            ...configDraft.tasks[task],
                            maxTokens: Number(e.target.value),
                          },
                        },
                      })
                    }
                  />
                </label>
              </div>
            ))}
          </div>

          <datalist id="ollama-models">
            {(data?.models ?? []).map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>

          <Button type="button" disabled={saving} onClick={() => void saveModels()}>
            Enregistrer les modèles
          </Button>
        </section>
      ) : null}

      {tab === "prompts" && data ? (
        <section className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {PROMPT_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setPromptKey(key)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm",
                  promptKey === key
                    ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                    : "bg-[var(--surface)] text-[var(--muted)]",
                )}
              >
                {key}
                {data.config.activePrompts[key]
                  ? " · actif"
                  : " · code"}
              </button>
            ))}
          </div>

          <p className="text-sm text-[var(--muted)]">
            Placeholders :{" "}
            <code className="text-xs">
              {"{{documentText}} {{categoryLabel}} {{checklist}} {{focusList}} {{schema}} {{query}} …"}
            </code>
          </p>

          <div className="space-y-3 rounded-xl border border-[var(--border)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {editingParentId
                  ? "Nouvelle version (à partir d’une ancienne)"
                  : "Nouvelle version"}
              </p>
              <Button
                type="button"
                variant="ghost"
                onClick={() => activatePrompt(null)}
              >
                Utiliser le prompt code
              </Button>
            </div>
            <p className="text-xs text-[var(--muted)]">
              Chaque enregistrement crée une version immuable (v1, v2…). Pour
              revenir en arrière : « Revenir à cette version ».
            </p>
            <input
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              placeholder="Label"
              value={promptLabel}
              onChange={(e) => setPromptLabel(e.target.value)}
            />
            <textarea
              className="min-h-56 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs leading-relaxed"
              value={promptContent}
              onChange={(e) => setPromptContent(e.target.value)}
              placeholder="Contenu du prompt…"
            />
            <Button type="button" disabled={saving} onClick={() => void savePrompt()}>
              Créer & activer la version
            </Button>
          </div>

          <ul className="space-y-3">
            {versionsForKey.map((version) => {
              const active =
                data.config.activePrompts[version.key] === version.id;
              return (
                <li
                  key={version.id}
                  className="rounded-xl border border-[var(--border)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">
                        <span className="mr-2 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-xs text-[var(--accent)]">
                          v{version.version}
                        </span>
                        {version.label}
                        {active ? (
                          <span className="ml-2 text-xs text-[var(--accent)]">
                            ACTIF
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {version.createdAt}
                        {version.parentId
                          ? ` · parent ${version.parentId.slice(0, 8)}…`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!active ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => void rollback(version.id)}
                        >
                          Revenir à cette version
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => startEdit(version)}
                      >
                        Éditer (→ nouvelle v)
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => startFork(version)}
                      >
                        Fork
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => void removePrompt(version.id)}
                      >
                        Supprimer
                      </Button>
                    </div>
                  </div>
                  <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-[var(--surface)] p-3 text-[11px] text-[var(--muted)]">
                    {version.content.slice(0, 500)}
                    {version.content.length > 500 ? "…" : ""}
                  </pre>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {tab === "monitoring" ? (
        <section className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[var(--muted)]">
              Santé production (24h) — analyses, file Ollama, GPU, erreurs 5xx.
            </p>
            <Button
              type="button"
              disabled={monitoringBusy}
              onClick={() => {
                setMonitoringBusy(true);
                void runAdminMonitoringCheck()
                  .then((result) => {
                    setMonitoring({
                      snapshot: result.snapshot,
                      alerts: result.alerts,
                    });
                    setMessage(
                      result.newAlerts.length
                        ? `Alertes: ${result.newAlerts.join(", ")}`
                        : "Check OK — aucune nouvelle alerte.",
                    );
                  })
                  .catch((err) =>
                    setError(
                      err instanceof Error ? err.message : "Check impossible",
                    ),
                  )
                  .finally(() => setMonitoringBusy(false));
              }}
            >
              {monitoringBusy ? "Check…" : "Lancer un check"}
            </Button>
          </div>
          {monitoring ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <Stat
                  label="Analyses"
                  value={String(monitoring.snapshot.analysis.count)}
                />
                <Stat
                  label="Succès"
                  value={`${Math.round(monitoring.snapshot.analysis.successRate * 100)}%`}
                />
                <Stat
                  label="Durée moy."
                  value={`${monitoring.snapshot.analysis.avgDurationMs} ms`}
                />
                <Stat
                  label="Attente moy."
                  value={`${monitoring.snapshot.analysis.avgWaitMs} ms`}
                />
                <Stat
                  label="Erreurs 5xx"
                  value={String(monitoring.snapshot.serverErrors24h)}
                />
                <Stat
                  label="GPU"
                  value={
                    monitoring.snapshot.gpu.utilizationPercent == null
                      ? monitoring.snapshot.workers.ollamaUp
                        ? "OK"
                        : "DOWN"
                      : `${monitoring.snapshot.gpu.utilizationPercent}%`
                  }
                />
              </div>
              <p className="text-xs text-[var(--muted)]">
                Workers: Ollama{" "}
                {monitoring.snapshot.workers.ollamaUp ? "up" : "down"} · gén.
                actives {monitoring.snapshot.workers.activeGenerations}
                {monitoring.snapshot.gpu.model
                  ? ` · modèle ${monitoring.snapshot.gpu.model}`
                  : ""}
                {" · "}
                snapshot {new Date(monitoring.snapshot.at).toLocaleString("fr-FR")}
              </p>
              <ul className="space-y-2">
                {monitoring.alerts.slice(0, 20).map((alert) => (
                  <li
                    key={alert.id}
                    className="rounded-xl border border-[var(--border)] px-4 py-3 text-sm"
                  >
                    <span
                      className={
                        alert.severity === "critical"
                          ? "text-[var(--danger)]"
                          : "text-[var(--warning)]"
                      }
                    >
                      [{alert.severity}] {alert.code}
                    </span>
                    <span className="ml-2 text-[var(--muted)]">
                      {alert.message}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </section>
      ) : null}

      {tab === "performance" && data ? (
        <section className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat
              label="Appels"
              value={String(data.performance.totalCalls)}
            />
            <Stat
              label="Succès"
              value={`${Math.round(data.performance.successRate * 100)}%`}
            />
            <Stat
              label="Latence moy."
              value={`${data.performance.avgDurationMs} ms`}
            />
            <Stat
              label="p95"
              value={`${data.performance.p95DurationMs} ms`}
            />
          </div>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--border)] text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3">Tâche</th>
                  <th className="px-4 py-3">N</th>
                  <th className="px-4 py-3">Moy. ms</th>
                  <th className="px-4 py-3">Succès</th>
                </tr>
              </thead>
              <tbody>
                {data.performance.byTask.map((row) => (
                  <tr key={row.task} className="border-b border-[var(--border)]/60">
                    <td className="px-4 py-3">{TASK_LABELS[row.task] ?? row.task}</td>
                    <td className="px-4 py-3">{row.count}</td>
                    <td className="px-4 py-3">{row.avgDurationMs}</td>
                    <td className="px-4 py-3">
                      {Math.round(row.successRate * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h2 className="mb-2 font-display text-xl">Événements récents</h2>
            <ul className="space-y-2 text-sm">
              {data.recentEvents.slice(0, 15).map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
                >
                  <span>
                    {event.task} · {event.model} · {event.durationMs}ms
                  </span>
                  <span className={event.ok ? "text-[var(--accent)]" : "text-[var(--danger)]"}>
                    {event.ok ? "ok" : event.errorMessage ?? "erreur"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {tab === "product" && data ? (
        <section className="space-y-5">
          {!data.productAnalytics ? (
            <p className="text-sm text-[var(--muted)]">
              Aucune donnée produit pour le moment.
            </p>
          ) : (
            <>
              <p className="text-sm text-[var(--muted)]">
                Fenêtre {data.productAnalytics.windowDays} jours ·{" "}
                {data.productAnalytics.totalEvents} événements
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat
                  label="Temps analyse (moy.)"
                  value={`${data.productAnalytics.analysisTotal.avgMs} ms`}
                />
                <Stat
                  label="P1 (moy.)"
                  value={`${data.productAnalytics.p1.avgMs} ms`}
                />
                <Stat
                  label="P2 (moy.)"
                  value={`${data.productAnalytics.p2.avgMs} ms`}
                />
                <Stat
                  label="OCR (moy.)"
                  value={`${data.productAnalytics.ocr.avgMs} ms`}
                />
                <Stat
                  label="Erreurs"
                  value={String(data.productAnalytics.analysesErrored)}
                />
                <Stat
                  label="Taux fallback"
                  value={`${Math.round(data.productAnalytics.fallbackRate * 100)}%`}
                />
                <Stat
                  label="Satisfaction"
                  value={
                    data.productAnalytics.satisfaction.average === null
                      ? "—"
                      : `${data.productAnalytics.satisfaction.average}/5`
                  }
                />
                <Stat
                  label="Taux d'abandon"
                  value={`${Math.round(data.productAnalytics.abandonRate * 100)}%`}
                />
                <Stat
                  label="Conversion free→premium"
                  value={`${Math.round(data.productAnalytics.conversion.freeToPremiumRate * 100)}%`}
                />
                <Stat
                  label="Coût moyen / analyse"
                  value={`${data.productAnalytics.cost.avgPerAnalysisEur.toFixed(4)} €`}
                />
                <Stat
                  label="Extractions"
                  value={`${data.productAnalytics.extraction.count} · ${data.productAnalytics.extraction.avgMs} ms`}
                />
                <Stat
                  label="Analyses complétées"
                  value={String(data.productAnalytics.analysesCompleted)}
                />
              </div>

              <div>
                <h2 className="mb-2 font-display text-xl">
                  Documents les plus analysés
                </h2>
                {data.productAnalytics.topDocumentTypes.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">Pas encore de données.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {data.productAnalytics.topDocumentTypes.map((row) => (
                      <li
                        key={row.label}
                        className="flex justify-between rounded-lg border border-[var(--border)] px-3 py-2"
                      >
                        <span>{row.label}</span>
                        <span className="text-[var(--muted)]">×{row.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h2 className="mb-2 font-display text-xl">Erreurs récentes</h2>
                {data.productAnalytics.recentErrors.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">Aucune erreur produit.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {data.productAnalytics.recentErrors.map((err, index) => (
                      <li
                        key={`${err.at}-${index}`}
                        className="rounded-lg border border-[var(--border)] px-3 py-2"
                      >
                        <p className="text-[var(--danger)]">{err.message}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {err.phase} · {err.code} · {err.at}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </section>
      ) : null}

      {tab === "errors" && data ? (
        <section className="space-y-3">
          {data.frequentErrors.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Aucune erreur enregistrée.</p>
          ) : (
            data.frequentErrors.map((item) => (
              <article
                key={item.key}
                className="rounded-xl border border-[var(--border)] p-4"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="font-medium">{item.sampleMessage}</p>
                  <p className="text-sm text-[var(--danger)]">×{item.count}</p>
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {item.task} · dernier {item.lastAt}
                </p>
              </article>
            ))
          )}
        </section>
      ) : null}

      {tab === "reanalyze" ? (
        <section className="space-y-4">
          <p className="text-sm text-[var(--muted)]">
            Relance le pipeline avec le texte déjà extrait (modèle/prompts Admin
            actuels).
          </p>
          <select
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            value={reanalyzeId}
            onChange={(e) => setReanalyzeId(e.target.value)}
          >
            <option value="">Choisir un document…</option>
            {history.map((item) => (
              <option key={item.id} value={item.id}>
                {item.fileName} — {item.categoryLabel}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={!reanalyzeId || reanalyzeBusy}
              onClick={() => void runReanalyze()}
            >
              {reanalyzeBusy ? "Analyse…" : "Relancer l'analyse"}
            </Button>
            {reanalyzeId ? (
              <Link
                href={`/historique/${reanalyzeId}`}
                className="inline-flex h-9 items-center text-sm text-[var(--accent)]"
              >
                Voir la fiche
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {tab === "compare" && data ? (
        <section className="space-y-4">
          <p className="text-sm text-[var(--muted)]">
            Diff texte des prompts, ou exécution des deux versions sur un échantillon.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted)]">Version A</span>
              <select
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                value={compareA}
                onChange={(e) => setCompareA(e.target.value)}
              >
                <option value="">—</option>
                {data.prompts.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    [{v.key}] {v.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-[var(--muted)]">Version B</span>
              <select
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                value={compareB}
                onChange={(e) => setCompareB(e.target.value)}
              >
                <option value="">—</option>
                {data.prompts.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    [{v.key}] {v.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <textarea
            className="min-h-28 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            placeholder="Texte d'échantillon (requis pour comparer les sorties modèle)"
            value={compareSample}
            onChange={(e) => setCompareSample(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={!compareA || !compareB || compareBusy}
              onClick={() => void runCompare("diff")}
            >
              Diff prompts
            </Button>
            <Button
              type="button"
              disabled={
                !compareA || !compareB || !compareSample.trim() || compareBusy
              }
              onClick={() => void runCompare("run")}
            >
              Comparer sorties IA
            </Button>
          </div>
          {compareResult ? (
            <CompareResultView result={compareResult} />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 font-display text-2xl">{value}</p>
    </div>
  );
}

function CompareResultView({ result }: { result: Record<string, unknown> }) {
  const lines = (result.lines ?? result.outputDiff) as
    | Array<{ type: string; text: string }>
    | undefined;
  const mode = String(result.mode ?? "");

  return (
    <div className="space-y-4 rounded-xl border border-[var(--border)] p-4">
      <p className="text-sm text-[var(--muted)]">Mode : {mode}</p>
      {mode === "run" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs text-[var(--muted)]">
              Sortie A ({String(result.durationAMs)} ms)
            </p>
            <pre className="max-h-64 overflow-auto rounded-lg bg-[var(--surface)] p-3 text-[11px]">
              {String(result.outputA ?? "")}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-xs text-[var(--muted)]">
              Sortie B ({String(result.durationBMs)} ms)
            </p>
            <pre className="max-h-64 overflow-auto rounded-lg bg-[var(--surface)] p-3 text-[11px]">
              {String(result.outputB ?? "")}
            </pre>
          </div>
        </div>
      ) : null}
      {lines ? (
        <div className="max-h-80 overflow-auto rounded-lg bg-[var(--surface)] p-3 font-mono text-[11px]">
          {lines.slice(0, 400).map((line, index) => (
            <div
              key={`${index}-${line.type}`}
              className={cn(
                line.type === "added" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                line.type === "removed" && "bg-red-500/10 text-red-700 dark:text-red-300",
              )}
            >
              <span className="opacity-50">
                {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
              </span>{" "}
              {line.text}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
