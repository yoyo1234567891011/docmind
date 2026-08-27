/**
 * Sonde health LLM alignée sur le fournisseur réellement utilisé.
 * Aucun secret dans les retours — uniquement ok / backend.
 */

import { getOllamaBaseUrl } from "@/ai/models/config";
import {
  getLlmProviderConfig,
  isCloudLlmEnabled,
} from "@/ai/models/llm-provider";
import { pingOpenAiCompatible } from "@/ai/models/openai-compatible-generate";
import {
  assertSafeOllamaBaseUrl,
  fetchOllama,
} from "@/ai/models/ollama-http";

export type LlmHealthBackend = "cloud" | "ollama";

export type LlmHealthResult = {
  ok: boolean;
  backend: LlmHealthBackend;
};

function forcedProvider(): string | undefined {
  return process.env.LLM_PROVIDER?.trim().toLowerCase() || undefined;
}

/**
 * Backend que le health doit sonder.
 * - LLM_PROVIDER=ollama → Ollama (même si une clé cloud existe)
 * - LLM_PROVIDER=openai_compatible|cloud → cloud (jamais Ollama)
 * - sinon → cloud si clé présente, sinon Ollama
 */
export function resolveLlmHealthBackend(): LlmHealthBackend {
  const forced = forcedProvider();
  if (forced === "ollama") return "ollama";
  if (forced === "openai_compatible" || forced === "cloud") return "cloud";
  return isCloudLlmEnabled() ? "cloud" : "ollama";
}

async function checkOllama(timeoutMs: number): Promise<boolean> {
  assertSafeOllamaBaseUrl(getOllamaBaseUrl());
  const response = await fetchOllama(getOllamaBaseUrl(), "/api/tags", {
    method: "GET",
    signal: AbortSignal.timeout(timeoutMs),
  });
  return response.ok;
}

async function checkCloud(timeoutMs: number): Promise<boolean> {
  const provider = getLlmProviderConfig();
  if (provider.kind !== "openai_compatible") return false;
  // Config cloud incomplète → down (pas de repli Ollama : éviter faux négatif Vercel).
  if (!provider.apiKey || !provider.baseUrl || !provider.model) return false;
  return pingOpenAiCompatible(provider, timeoutMs);
}

/**
 * Exécute la sonde adaptée au fournisseur configuré.
 * Les erreurs réseau / timeout sont absorbées → ok=false (pas de fuite de détails).
 */
export async function checkLlmHealth(options?: {
  cloudTimeoutMs?: number;
  ollamaTimeoutMs?: number;
}): Promise<LlmHealthResult> {
  const backend = resolveLlmHealthBackend();
  const cloudTimeoutMs = options?.cloudTimeoutMs ?? 8_000;
  const ollamaTimeoutMs = options?.ollamaTimeoutMs ?? 5_000;

  try {
    if (backend === "cloud") {
      const ok = await checkCloud(cloudTimeoutMs);
      return { ok, backend: "cloud" };
    }
    const ok = await checkOllama(ollamaTimeoutMs);
    return { ok, backend: "ollama" };
  } catch {
    return { ok: false, backend };
  }
}
