/**
 * Generate via API OpenAI-compatible (Groq, Mistral, …).
 */

import { AppError } from "@/lib/errors";
import { LLM_SATURATION_USER_MESSAGE } from "@/lib/sanitize";
import type { CloudLlmConfig } from "@/ai/models/llm-provider";
import type { OllamaGenerateResult } from "@/ai/models/types";
import { isAbortError } from "@/ai/models/ollama-http";

export type OpenAiCompatibleGenerateInput = {
  prompt: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  formatJson?: boolean;
  signal?: AbortSignal;
  cloud: CloudLlmConfig;
};

type ChatCompletionResponse = {
  model?: string;
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

const EMPTY_RESPONSE_RETRIES = 2;
const RATE_LIMIT_RETRIES = 3;
/** Groq free TPM ~8k : ne pas réserver trop de completion tokens. */
const GROQ_MAX_COMPLETION_TOKENS = 1_600;
const RATE_LIMIT_WAIT_CAP_MS = 90_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitPayload(status: number, body: string): boolean {
  if (status === 429) return true;
  return /rate_limit_exceeded|tokens per minute|\bTPM\b|too many requests/i.test(
    body,
  );
}

function parseRetryAfterMs(response: Response, body: string): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const asNumber = Number(header);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return Math.min(Math.ceil(asNumber * 1000) + 750, RATE_LIMIT_WAIT_CAP_MS);
    }
    const asDate = Date.parse(header);
    if (Number.isFinite(asDate)) {
      return Math.min(
        Math.max(0, asDate - Date.now()) + 750,
        RATE_LIMIT_WAIT_CAP_MS,
      );
    }
  }

  const match = body.match(/try again in\s+([\d.]+)\s*s/i);
  if (match) {
    const sec = Number(match[1]);
    if (Number.isFinite(sec) && sec > 0) {
      return Math.min(Math.ceil(sec * 1000) + 750, RATE_LIMIT_WAIT_CAP_MS);
    }
  }

  return 20_000;
}

function httpErrorToAppError(status: number, details: string): AppError {
  if (isRateLimitPayload(status, details)) {
    return new AppError("OLLAMA_UNAVAILABLE", LLM_SATURATION_USER_MESSAGE, 503);
  }
  // Ne jamais renvoyer le JSON brut Groq à l’UI.
  if (details.trim().startsWith("{")) {
    return new AppError(
      "OLLAMA_UNAVAILABLE",
      `Le service d’analyse a renvoyé une erreur temporaire (${status}). Réessayez dans un instant.`,
      status === 429 ? 503 : 502,
    );
  }
  return new AppError(
    "OLLAMA_UNAVAILABLE",
    details.slice(0, 280) ||
      `API LLM a renvoyé une erreur (${status}).`,
    502,
  );
}

export async function generateWithOpenAiCompatible(
  input: OpenAiCompatibleGenerateInput,
): Promise<OllamaGenerateResult> {
  const started = Date.now();
  const url = `${input.cloud.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const model = input.model || input.cloud.model;
  const isGroq = input.cloud.baseUrl.includes("groq.com");

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: input.prompt }],
    temperature: input.temperature ?? 0.2,
    stream: false,
  };
  if (typeof input.maxTokens === "number" && input.maxTokens > 0) {
    body.max_tokens = isGroq
      ? Math.min(input.maxTokens, GROQ_MAX_COMPLETION_TOKENS)
      : input.maxTokens;
  }
  // Groq free-tier retourne json_validate_failed de façon sporadique avec
  // response_format strict (quelle que soit la taille du modèle).
  // On désactive pour tout Groq ; tryParseJsonObject extrait le JSON du texte libre.
  if (input.formatJson !== false && !isGroq) {
    body.response_format = { type: "json_object" };
  }

  let lastFinishReason: string | undefined;
  let rateLimitAttempts = 0;
  let emptyAttempts = 0;
  const maxAttempts = EMPTY_RESPONSE_RETRIES + RATE_LIMIT_RETRIES + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.cloud.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: input.signal,
        cache: "no-store",
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new AppError(
        "OLLAMA_UNAVAILABLE",
        `API LLM injoignable (${input.cloud.baseUrl}). ${
          error instanceof Error ? error.message : "erreur réseau"
        }`,
        503,
      );
    }

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      if (
        isRateLimitPayload(response.status, details) &&
        rateLimitAttempts < RATE_LIMIT_RETRIES
      ) {
        rateLimitAttempts += 1;
        const waitMs = parseRetryAfterMs(response, details);
        console.warn(
          `[llm] rate_limit model=${model} waitMs=${waitMs} attempt=${rateLimitAttempts}/${RATE_LIMIT_RETRIES}`,
        );
        // Freiner les claims P2 pendant la saturation (best-effort).
        void import("@/services/analysis-jobs/p2-concurrency")
          .then(({ noteP2RateLimitHit }) => noteP2RateLimitHit())
          .catch(() => undefined);
        await sleep(waitMs);
        continue;
      }
      throw httpErrorToAppError(response.status, details);
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
    lastFinishReason = payload.choices?.[0]?.finish_reason ?? undefined;

    if (text) {
      const promptTokens = payload.usage?.prompt_tokens ?? 0;
      const completionTokens = payload.usage?.completion_tokens ?? 0;
      const durationMs = Date.now() - started;

      return {
        text,
        model: payload.model || model,
        promptTokens,
        completionTokens,
        totalTokens:
          payload.usage?.total_tokens ?? promptTokens + completionTokens,
        durationMs,
      };
    }

    const truncated = lastFinishReason === "length";
    emptyAttempts += 1;
    console.warn(
      `[llm] empty chat completion attempt=${emptyAttempts}/${EMPTY_RESPONSE_RETRIES + 1} model=${model} finish=${lastFinishReason ?? "unknown"} truncated=${truncated}`,
    );

    if (emptyAttempts <= EMPTY_RESPONSE_RETRIES) {
      if (truncated && typeof body.max_tokens === "number") {
        const cap = isGroq ? GROQ_MAX_COMPLETION_TOKENS : 4096;
        body.max_tokens = Math.min(Math.floor(body.max_tokens * 1.35), cap);
      }
      await sleep(700 * emptyAttempts);
      continue;
    }
    break;
  }

  throw new AppError(
    "OLLAMA_UNAVAILABLE",
    lastFinishReason === "length"
      ? "Réponse IA tronquée (limite de tokens). Réessayez — le document sera retraité."
      : lastFinishReason
        ? `API LLM a renvoyé une réponse vide (${lastFinishReason}). Réessayez dans un instant.`
        : "API LLM a renvoyé une réponse vide. Réessayez dans un instant.",
    502,
  );
}

/** Ping léger pour /api/health (liste modèles). */
export async function pingOpenAiCompatible(
  cloud: CloudLlmConfig,
  timeoutMs = 8_000,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${cloud.baseUrl.replace(/\/$/, "")}/models`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${cloud.apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}
