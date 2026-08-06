import { createHash } from "crypto";

import { AppError } from "@/lib/errors";
import type { AiTask } from "@/ai/models/config";
import {
  ensureOllamaReachable,
  fetchOllama,
  isAbortError,
  normalizeOllamaBaseUrl,
} from "@/ai/models/ollama-http";
import { withOllamaGenerateLock } from "@/ai/models/generate-lock";
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

export { ensureOllamaReachable, normalizeOllamaBaseUrl };
export { getOllamaGenerateLockState } from "@/ai/models/generate-lock";

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

  const timeoutMs =
    typeof options.timeoutMs === "number" && options.timeoutMs > 0
      ? options.timeoutMs
      : resolveGenerateTimeoutMs();
  const key = lockKeyForPrompt(model, prompt);

  return withOllamaGenerateLock(key, async () => {
    const controller = new AbortController();
    let timedOut = false;

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

    console.info(
      `[ollama] generate start key=${key} model=${model} promptChars=${prompt.length} timeoutMs=${timeoutMs}`,
    );

    try {
      const result = await postGenerateToOllama(
        baseUrl,
        payload,
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
      const durationMs = Date.now() - started;

      console.info(
        `[ollama] generate done key=${key} durationMs=${durationMs} promptTok=${promptTokens} completionTok=${completionTokens}`,
      );

      return {
        text,
        model: result.model || model,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        durationMs,
      };
    } catch (error) {
      const elapsed = Date.now() - started;
      if (timedOut || isAbortError(error)) {
        console.info(
          `[ollama] generate cancelled key=${key} elapsedMs=${elapsed} reason=${timedOut ? "timeout" : "abort"}`,
        );
        throw new AppError(
          "OLLAMA_UNAVAILABLE",
          `Ollama n'a pas répondu sous ${Math.round(timeoutMs / 1000)}s (requête annulée). Relancez l'analyse ou vérifiez que le modèle n'est pas saturé.`,
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
export async function generateForTask(
  task: Exclude<AiTask, "embed">,
  prompt: string,
): Promise<OllamaGenerateResult> {
  await ensureAdminRuntimeLoaded();
  const config = await resolveTaskConfig(task);
  const started = Date.now();

  try {
    const result = await generateWithOllama({
      prompt,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
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
