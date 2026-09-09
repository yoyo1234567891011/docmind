/**
 * Préflight LLM E2E — LOCAL (Ollama) ou STAGING (cloud Groq).
 */
import { expect, type Page } from "@playwright/test";

import {
  LOCAL_OLLAMA_MODEL,
  resolveE2eTarget,
  STAGING_CLOUD_BASE,
  STAGING_CLOUD_MODEL,
} from "./env-target";

export const REQUIRED_OLLAMA_MODEL = LOCAL_OLLAMA_MODEL;
export const REQUIRED_OLLAMA_BASE = "http://127.0.0.1:11434";

type TagsResponse = {
  models?: Array<{ name?: string; model?: string }>;
};

export async function fetchOllamaTags(
  baseUrl = REQUIRED_OLLAMA_BASE,
): Promise<TagsResponse> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(
      `Ollama inaccessible (${baseUrl}/api/tags → HTTP ${res.status}). ` +
        `Démarrez Ollama puis vérifiez OLLAMA_BASE_URL.`,
    );
  }
  return (await res.json()) as TagsResponse;
}

export function assertModelInTags(
  tags: TagsResponse,
  model = REQUIRED_OLLAMA_MODEL,
): void {
  const names = (tags.models ?? []).map((m) => m.name || m.model || "");
  const ok = names.some(
    (n) => n === model || n.startsWith(`${model}:`) || n === `${model}:latest`,
  );
  if (!ok) {
    throw new Error(
      `Modèle Ollama requis indisponible : « ${model} ». ` +
        `Modèles présents : [${names.join(", ") || "(aucun)"}]. ` +
        `Installez-le avec : ollama pull ${model} ` +
        `(≈65 Go RAM — ou utilisez E2E_TARGET=staging).`,
    );
  }
}

export async function pingOllamaModel(
  model = REQUIRED_OLLAMA_MODEL,
  baseUrl = REQUIRED_OLLAMA_BASE,
): Promise<void> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: "Réponds uniquement: OK",
      stream: false,
      options: { num_predict: 8 },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Le modèle « ${model} » ne répond pas (HTTP ${res.status}): ${text.slice(0, 400)}. ` +
        `Si OOM local : E2E_TARGET=staging (cloud openai/gpt-oss-120b).`,
    );
  }
  let json: { response?: string; error?: string };
  try {
    json = JSON.parse(text) as { response?: string; error?: string };
  } catch {
    throw new Error(`Réponse Ollama non JSON pour « ${model} »: ${text.slice(0, 200)}`);
  }
  if (json.error) {
    throw new Error(`Erreur Ollama « ${model} »: ${json.error}`);
  }
  if (!json.response?.trim()) {
    throw new Error(`Réponse vide du modèle « ${model} ».`);
  }
}

async function pingStagingCloud(): Promise<void> {
  const apiKey =
    process.env.E2E_STAGING_GROQ_API_KEY?.trim() ||
    process.env.GROQ_API_KEY?.trim() ||
    process.env.LLM_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "STAGING E2E : clé cloud absente (E2E_STAGING_GROQ_API_KEY dans .env.e2e.staging.local).",
    );
  }
  const base =
    process.env.LLM_API_BASE_URL?.trim().replace(/\/$/, "") ||
    STAGING_CLOUD_BASE;
  const model = process.env.LLM_MODEL?.trim() || STAGING_CLOUD_MODEL;
  if (model !== STAGING_CLOUD_MODEL) {
    throw new Error(
      `STAGING E2E : LLM_MODEL=« ${model} » ≠ « ${STAGING_CLOUD_MODEL} ».`,
    );
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Réponds uniquement: OK" }],
      max_tokens: 8,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `STAGING cloud « ${model} » HTTP ${res.status}: ${text.slice(0, 400)}`,
    );
  }
}

/**
 * Préflight selon E2E_TARGET (local | staging).
 */
export async function requireGptOss120bReady(page: Page): Promise<void> {
  const target = resolveE2eTarget();

  if (target === "staging") {
    await pingStagingCloud();
    const health = await page.request.get("/api/health");
    expect(health.ok(), await health.text()).toBeTruthy();
    const body = (await health.json()) as { status?: string; ok?: boolean };
    if (body.status !== "ok" || body.ok !== true) {
      throw new Error(
        `STAGING / E2E : health LLM non OK (status=${body.status}, ok=${body.ok}). ` +
          `Attendu : LLM_PROVIDER=openai_compatible + ${STAGING_CLOUD_MODEL}.`,
      );
    }
    return;
  }

  const base =
    process.env.OLLAMA_BASE_URL?.trim().replace(/\/$/, "") ||
    REQUIRED_OLLAMA_BASE;
  const model = REQUIRED_OLLAMA_MODEL;
  const envModel = process.env.OLLAMA_MODEL?.trim();
  if (envModel && envModel !== REQUIRED_OLLAMA_MODEL) {
    throw new Error(
      `OLLAMA_MODEL=« ${envModel} » ≠ modèle requis « ${REQUIRED_OLLAMA_MODEL} ».`,
    );
  }

  const tags = await fetchOllamaTags(base);
  assertModelInTags(tags, model);
  await pingOllamaModel(model, base);

  const health = await page.request.get("/api/health");
  expect(health.ok(), await health.text()).toBeTruthy();
  const body = (await health.json()) as { status?: string; ok?: boolean };
  if (body.status !== "ok" || body.ok !== true) {
    throw new Error(
      `LOCAL E2E : health LLM non OK (status=${body.status}, ok=${body.ok}).`,
    );
  }
}
