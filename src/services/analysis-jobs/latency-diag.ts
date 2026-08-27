/**
 * Diagnostic latence P2 — instrumentation temporaire (observabilité uniquement).
 * Aucun changement fonctionnel du pipeline.
 *
 * Limitation TTFT : l’appel Groq est en stream:false → pas de vrai first-token.
 * On mesure TTFB = request_start → response.headers (meilleure proxy disponible).
 */
import { AsyncLocalStorage } from "async_hooks";

export type LatencyDiag = {
  /** job_created → worker_start (claim) */
  queueMs: number;
  /** prep locale avant LLM (facts, knowledge, prompt) */
  preparationMs: number;
  /** éventuelle attente lock / spacing avant fetch Groq */
  preLlmWaitMs: number;
  /** request_start → headers reçus (réseau + file Groq, pas TTFT réel) */
  networkTtfbMs: number | null;
  /**
   * Alias demandé LLM_WAIT / TTFT — proxy = TTFB (stream:false).
   * null si non mesurable.
   */
  llmWaitMs: number | null;
  /** headers → body JSON complet (proxy génération + transfert) */
  llmGenerateProxyMs: number | null;
  /** request_start → response_end */
  llmTotalMs: number | null;
  /** parsing JSON + enrich thin */
  parsingMs: number;
  /** salvage JSON local (0 si non utiliséé) */
  salvageMs: number;
  /** score agent */
  scoreMs: number;
  /** verify + scrub + inject local risks */
  verifyMs: number;
  /** updateHistoryRecord */
  historyDbMs: number;
  /** notifications + monitoring */
  notifyMs: number;
  /** attente memory sync (hors chemin critique UI) */
  memoryMs: number | null;
  /** job_created → completed */
  totalMs: number;
  /** meta */
  meta: {
    ttftAvailable: false;
    ttftMethod: "ttfb_headers_proxy";
    stream: false;
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    salvaged: boolean;
    /** Nombre de retries LLM bundle sur JSON invalide / tronqué. */
    jsonBundleRetries?: number;
    jobId?: string;
    documentLabel?: string;
  };
};

type MutableDiag = {
  marks: Record<string, number>;
  spans: Partial<Record<keyof Omit<LatencyDiag, "meta">, number>>;
  meta: LatencyDiag["meta"];
};

const als = new AsyncLocalStorage<MutableDiag>();

export function createLatencyDiagStore(): MutableDiag {
  return {
    marks: {},
    spans: {},
    meta: {
      ttftAvailable: false,
      ttftMethod: "ttfb_headers_proxy",
      stream: false,
      salvaged: false,
    },
  };
}

export function runWithLatencyDiag<T>(
  store: MutableDiag,
  fn: () => Promise<T>,
): Promise<T> {
  return als.run(store, fn);
}

export function getLatencyDiagStore(): MutableDiag | undefined {
  return als.getStore();
}

export function latencyMark(name: string, at = Date.now()): void {
  const store = als.getStore();
  if (!store) return;
  store.marks[name] = at;
}

export function latencySpan(
  name: keyof Omit<LatencyDiag, "meta">,
  ms: number,
): void {
  const store = als.getStore();
  if (!store) return;
  if (!(ms >= 0) || !Number.isFinite(ms)) return;
  store.spans[name] = Math.round(ms);
}

export function latencyMeta(
  patch: Partial<LatencyDiag["meta"]>,
): void {
  const store = als.getStore();
  if (!store) return;
  Object.assign(store.meta, patch);
}

export function measureLatencySpan<T>(
  name: keyof Omit<LatencyDiag, "meta">,
  fn: () => T,
): T {
  const started = Date.now();
  const result = fn();
  latencySpan(name, Date.now() - started);
  return result;
}

export async function measureLatencySpanAsync<T>(
  name: keyof Omit<LatencyDiag, "meta">,
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    latencySpan(name, Date.now() - started);
  }
}

export function finalizeLatencyDiag(input: {
  jobCreatedAt: string;
  completedAt?: number;
}): LatencyDiag | null {
  const store = als.getStore();
  if (!store) return null;

  const completedAt = input.completedAt ?? Date.now();
  const createdMs = Date.parse(input.jobCreatedAt);
  const totalMs = Number.isFinite(createdMs)
    ? Math.max(0, completedAt - createdMs)
    : store.spans.totalMs ?? 0;

  const diag: LatencyDiag = {
    queueMs: store.spans.queueMs ?? 0,
    preparationMs: store.spans.preparationMs ?? 0,
    preLlmWaitMs: store.spans.preLlmWaitMs ?? 0,
    networkTtfbMs: store.spans.networkTtfbMs ?? null,
    llmWaitMs: store.spans.llmWaitMs ?? store.spans.networkTtfbMs ?? null,
    llmGenerateProxyMs: store.spans.llmGenerateProxyMs ?? null,
    llmTotalMs: store.spans.llmTotalMs ?? null,
    parsingMs: store.spans.parsingMs ?? 0,
    salvageMs: store.spans.salvageMs ?? 0,
    scoreMs: store.spans.scoreMs ?? 0,
    verifyMs: store.spans.verifyMs ?? 0,
    historyDbMs: store.spans.historyDbMs ?? 0,
    notifyMs: store.spans.notifyMs ?? 0,
    memoryMs: store.spans.memoryMs ?? null,
    totalMs,
    meta: { ...store.meta },
  };

  console.info(
    `[latency-diag] ${JSON.stringify({
      queue_s: +(diag.queueMs / 1000).toFixed(3),
      preparation_s: +(diag.preparationMs / 1000).toFixed(3),
      pre_llm_wait_s: +(diag.preLlmWaitMs / 1000).toFixed(3),
      network_ttfb_s:
        diag.networkTtfbMs == null
          ? null
          : +(diag.networkTtfbMs / 1000).toFixed(3),
      llm_wait_proxy_s:
        diag.llmWaitMs == null ? null : +(diag.llmWaitMs / 1000).toFixed(3),
      llm_generate_proxy_s:
        diag.llmGenerateProxyMs == null
          ? null
          : +(diag.llmGenerateProxyMs / 1000).toFixed(3),
      llm_total_s:
        diag.llmTotalMs == null ? null : +(diag.llmTotalMs / 1000).toFixed(3),
      parsing_s: +(diag.parsingMs / 1000).toFixed(3),
      salvage_s: +(diag.salvageMs / 1000).toFixed(3),
      score_s: +(diag.scoreMs / 1000).toFixed(3),
      verify_s: +(diag.verifyMs / 1000).toFixed(3),
      history_db_s: +(diag.historyDbMs / 1000).toFixed(3),
      notify_s: +(diag.notifyMs / 1000).toFixed(3),
      memory_s:
        diag.memoryMs == null ? null : +(diag.memoryMs / 1000).toFixed(3),
      total_s: +(diag.totalMs / 1000).toFixed(3),
      meta: diag.meta,
    })}`,
  );

  return diag;
}
