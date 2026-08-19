/**
 * Generate via API OpenAI-compatible (Groq, Mistral, …).
 */

import { AppError } from "@/lib/errors";
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
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export async function generateWithOpenAiCompatible(
  input: OpenAiCompatibleGenerateInput,
): Promise<OllamaGenerateResult> {
  const started = Date.now();
  const url = `${input.cloud.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const model = input.model || input.cloud.model;

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: input.prompt }],
    temperature: input.temperature ?? 0.2,
    stream: false,
  };
  if (typeof input.maxTokens === "number" && input.maxTokens > 0) {
    body.max_tokens = input.maxTokens;
  }
  // Groq ne garantit pas json_object fiable sur ses modèles free
  // (json_validate_failed sporadique, thinking models tronqués).
  // On laisse le modèle répondre librement ; tryParseJsonObject extrait le JSON.
  const isGroq = input.cloud.baseUrl.includes("groq.com");
  if (input.formatJson !== false && !isGroq) {
    body.response_format = { type: "json_object" };
  }

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
    throw new AppError(
      "OLLAMA_UNAVAILABLE",
      details.slice(0, 400) ||
        `API LLM a renvoyé une erreur (${response.status}).`,
      502,
    );
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) {
    throw new AppError(
      "OLLAMA_UNAVAILABLE",
      "API LLM a renvoyé une réponse vide.",
      502,
    );
  }

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
