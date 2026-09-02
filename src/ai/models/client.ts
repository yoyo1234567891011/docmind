import { createHash } from "crypto";

import { AppError } from "@/lib/errors";
import type { AiTask } from "@/ai/models/config";
import {
  ensureOllamaReachable as ensureOllamaHttpReachable,
  fetchOllama,
  isAbortError,
  normalizeOllamaBaseUrl,
} from "@/ai/models/ollama-http";
import { withOllamaGenerateLock } from "@/ai/models/generate-lock";
import {
  getLlmProviderConfig,
  isCloudLlmEnabled,
} from "@/ai/models/llm-provider";
import { generateWithOpenAiCompatible } from "@/ai/models/openai-compatible-generate";
import type {
  OllamaGenerateOptions,
  OllamaGenerateRequest,
  OllamaGenerateResponse,
  OllamaGenerateResult,
} from "@/ai/models/types";
import { resolveOllamaKeepAlive } from "@/ai/optimizations";
import { docmindConfig } from "@/config/docmind";
import { resolveTaskConfig } from "@/services/admin/config-store";
import { appendAdminMetric } from "@/services/admin/metrics-store";
import { ensureAdminRuntimeLoaded } from "@/services/admin/runtime";
import { addAnalysisGenerateMs } from "@/services/analysis-jobs/timing";

export { normalizeOllamaBaseUrl };
export { getOllamaGenerateLockState } from "@/ai/models/generate-lock";

/** Ollama local ou no-op si provider cloud configuré. */
export async function ensureOllamaReachable(baseUrl: string): Promise<void> {
  if (isCloudLlmEnabled()) return;
  await ensureOllamaHttpReachable(baseUrl);
}

function lockKeyForPrompt(model: string, prompt: string): string {
  const hash = createHash("sha256").update(prompt).digest("hex").slice(0, 12);
  return `${model}:${hash}`;
}

function resolveGenerateTimeoutMs(): number {
  const timeoutFromEnv = Number(process.env.OLLAMA_GENERATE_TIMEOUT_MS);
  if (Number.isFinite(timeoutFromEnv) && timeoutFromEnv > 0) {
    return timeoutFromEnv;
  }
  return docmindConfig.ollama.generateTimeoutMs;
}

async function postGenerateToOllama(
  baseUrl: string,
  body: unknown,
  signal: AbortSignal,
): Promise<OllamaGenerateResponse> {
  const response = await fetchOllama(baseUrl, "/api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new AppError(
      "OLLAMA_UNAVAILABLE",
      details || `Ollama a renvoyé une erreur (${response.status}).`,
      502,
    );
  }

  return (await response.json()) as OllamaGenerateResponse;
}

/**
 * Low-level generate. Prefer `generateForTask` so model/temperature stay centralized.
 * Timeout → AbortController annule réellement le HTTP (Ollama stoppe la génération).
 * Verrou process : une seule génération /api/generate à la fois.
 */
export async function generateWithOllama(
  options: OllamaGenerateOptions & { baseUrl?: string },
): Promise<OllamaGenerateResult> {
  await ensureAdminRuntimeLoaded();
  const resolved = await resolveTaskConfig("analyze");
  const model = options.model ?? resolved.model;
  const baseUrl = normalizeOllamaBaseUrl(
    options.baseUrl ?? resolved.ollamaBaseUrl,
  );
  const prompt = options.prompt.trim();
  const started = Date.now();

  if (!prompt) {
    throw new AppError(
      "BAD_REQUEST",
      "Le prompt envoyé à Ollama ne peut pas être vide.",
    );
  }

  const numCtx =
    typeof options.numCtx === "number" && options.numCtx > 0
      ? options.numCtx
      : docmindConfig.ollama.numCtx;

  const keepAlive = resolveOllamaKeepAlive();

  const payload: OllamaGenerateRequest = {
    model,
    prompt,
    stream: false,
    // qwen3 burns minutes in <think> otherwise — keep analysis practical
    think: false,
    ...(options.formatJson !== false ? { format: "json" as const } : {}),
    ...(keepAlive !== undefined ? { keep_alive: keepAlive } : {}),
    options: {
      temperature: options.temperature ?? 0.2,
      ...(typeof options.maxTokens === "number" && options.maxTokens > 0
        ? { num_predict: options.maxTokens }
        : {}),
      ...(typeof numCtx === "number" && numCtx > 0 ? { num_ctx: numCtx } : {}),
    },
  };

  const timeoutMs = (() => {
    const base =
      typeof options.timeoutMs === "number" && options.timeoutMs > 0
        ? options.timeoutMs
        : resolveGenerateTimeoutMs();
    const provider = getLlmProviderConfig();
    if (provider.kind === "openai_compatible") {
      return Math.min(base, 120_000);
    }
    return base;
  })();
  const key = lockKeyForPrompt(model, prompt);

  return withOllamaGenerateLock(key, async () => {
    const controller = new AbortController();
    let timedOut = false;
    const generateStarted = Date.now();

    const timer = setTimeout(() => {
      timedOut = true;
      console.info(
        `[ollama] timeout ${Math.round(timeoutMs / 1000)}s — abort HTTP generate key=${key} model=${model}`,
      );
      controller.abort();
    }, timeoutMs);

    const onAbort = () => {
      console.info(
        `[ollama] abort signal received key=${key} elapsedMs=${Date.now() - started} timedOut=${timedOut}`,
      );
    };
    controller.signal.addEventListener("abort", onAbort, { once: true });

    const provider = getLlmProviderConfig();
    // Cloud : ignorer le tag Ollama du profil (mistral/qwen) — utiliser LLM_MODEL.
    const effectiveModel =
      provider.kind === "openai_compatible" ? provider.model : model;

    console.info(
      `[ollama] generate start key=${key} provider=${provider.kind} model=${effectiveModel} promptChars=${prompt.length} timeoutMs=${timeoutMs}`,
    );

    try {
      if (provider.kind === "openai_compatible") {
        const result = await generateWithOpenAiCompatible({
          prompt,
          model: effectiveModel,
          temperature: options.temperature ?? 0.2,
          maxTokens: options.maxTokens,
          formatJson: options.formatJson,
          signal: controller.signal,
          cloud: provider,
        });
        const generateMs = Date.now() - generateStarted;
        addAnalysisGenerateMs(generateMs);
        console.info(
          `[ollama] generate done key=${key} provider=cloud durationMs=${result.durationMs} generateMs=${generateMs}`,
        );
        return {
          ...result,
          durationMs: Date.now() - started,
        };
      }

      const result = await postGenerateToOllama(
        baseUrl,
        { ...payload, model: effectiveModel },
        controller.signal,
      );

      const text = result.response?.trim();
      if (!text) {
        throw new AppError(
          "OLLAMA_UNAVAILABLE",
          "Ollama a renvoyé une réponse vide.",
          502,
        );
      }

      const promptTokens = result.prompt_eval_count ?? 0;
      const completionTokens = result.eval_count ?? 0;
      const generateMs = Date.now() - generateStarted;
      const durationMs = Date.now() - started;
      addAnalysisGenerateMs(generateMs);

      console.info(
        `[ollama] generate done key=${key} durationMs=${durationMs} generateMs=${generateMs} promptTok=${promptTokens} completionTok=${completionTokens}`,
      );

      return {
        text,
        model: result.model || effectiveModel,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        durationMs,
      };
    } catch (error) {
      const elapsed = Date.now() - started;
      const generateMs = Date.now() - generateStarted;
      // Enregistre la durée réelle même en timeout/échec (observabilité load).
      addAnalysisGenerateMs(generateMs);
      if (timedOut || isAbortError(error)) {
        console.info(
          `[ollama] generate cancelled key=${key} elapsedMs=${elapsed} reason=${timedOut ? "timeout" : "abort"}`,
        );
        throw new AppError(
          "OLLAMA_UNAVAILABLE",
          `Le modèle n'a pas répondu sous ${Math.round(timeoutMs / 1000)}s (requête annulée). Relancez l'analyse.`,
          504,
        );
      }
      console.info(
        `[ollama] generate error key=${key} elapsedMs=${elapsed} message=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", onAbort);
    }
  });
}

/**
 * Generate using Admin runtime config (or env defaults).
 * Records latency / errors for the Admin performance panel.
 */
function resolveEffectiveMaxTokens(
  task: Exclude<AiTask, "embed">,
  configMaxTokens: number,
  override?: number,
): number {
  const requested =
    typeof override === "number" && override > 0 ? override : configMaxTokens;
  if (task === "analyze" && isCloudLlmEnabled()) {
    const softCap = docmindConfig.ollama.cloudAnalyzeMaxTokens;
    const hardCap =
      docmindConfig.ollama.cloudAnalyzeMaxTokensRetryCap ?? softCap;
    if (requested > softCap) {
      return Math.min(requested, hardCap);
    }
    return Math.min(requested, softCap);
  }
  return requested;
}

export async function generateForTask(
  task: Exclude<AiTask, "embed">,
  prompt: string,
  overrides?: { maxTokens?: number },
): Promise<OllamaGenerateResult> {
  await ensureAdminRuntimeLoaded();
  const config = await resolveTaskConfig(task);
  const started = Date.now();
  const maxTokens = resolveEffectiveMaxTokens(
    task,
    config.maxTokens ?? docmindConfig.ollama.maxTokens,
    overrides?.maxTokens,
  );

  try {
    const result = await generateWithOllama({
      prompt,
      model: config.model,
      temperature: config.temperature,
      maxTokens,
      baseUrl: config.ollamaBaseUrl,
    });

    await appendAdminMetric({
      task,
      model: result.model || config.model,
      durationMs: Date.now() - started,
      ok: true,
      promptChars: prompt.length,
      responseChars: result.text.length,
    });

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inconnue Ollama";
    const code =
      error instanceof AppError ? error.code : "OLLAMA_UNAVAILABLE";

    await appendAdminMetric({
      task,
      model: config.model,
      durationMs: Date.now() - started,
      ok: false,
      errorCode: code,
      errorMessage: message,
      promptChars: prompt.length,
    });

    throw error;
  }
}

export async function sendTextToOllama(
  text: string,
  model?: string,
): Promise<string> {
  const result = await generateWithOllama({
    prompt: text,
    model,
  });
  return result.text;
}

export async function listOllamaModels(): Promise<string[]> {
  await ensureAdminRuntimeLoaded();
  const provider = getLlmProviderConfig();
  if (provider.kind === "openai_compatible") {
    try {
      const response = await fetch(
        `${provider.baseUrl.replace(/\/$/, "")}/models`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${provider.apiKey}` },
          cache: "no-store",
        },
      );
      if (!response.ok) return [provider.model];
      const payload = (await response.json()) as {
        data?: Array<{ id?: string }>;
      };
      const ids = (payload.data ?? [])
        .map((m) => m.id ?? "")
        .filter(Boolean)
        .sort();
      return ids.length > 0 ? ids : [provider.model];
    } catch {
      return [provider.model];
    }
  }

  const config = await resolveTaskConfig("analyze");
  try {
    const response = await fetchOllama(config.ollamaBaseUrl, "/api/tags", {
      method: "GET",
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      models?: Array<{ name?: string }>;
    };
    return (payload.models ?? [])
      .map((m) => m.name ?? "")
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}
