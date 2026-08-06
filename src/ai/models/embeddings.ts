import { createHash } from "crypto";

import { getEmbedModel, getOllamaBaseUrl } from "@/ai/models/config";
import { fetchOllama } from "@/ai/models/ollama-http";

/** Cap LRU — évite croissance unbounded (texte long × vecteur). */
const MAX_EMBEDDING_CACHE = 512;
const embeddingCache = new Map<string, number[]>();

function embeddingCacheKey(model: string, text: string): string {
  const digest = createHash("sha256").update(text).digest("hex");
  return `${model}::${digest}`;
}

function getCachedEmbedding(key: string): number[] | undefined {
  const cached = embeddingCache.get(key);
  if (!cached) return undefined;
  // Refresh LRU order
  embeddingCache.delete(key);
  embeddingCache.set(key, cached);
  return cached;
}

function setCachedEmbedding(key: string, embedding: number[]): void {
  if (embeddingCache.has(key)) embeddingCache.delete(key);
  embeddingCache.set(key, embedding);
  while (embeddingCache.size > MAX_EMBEDDING_CACHE) {
    const oldest = embeddingCache.keys().next().value;
    if (oldest === undefined) break;
    embeddingCache.delete(oldest);
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return Math.max(0, Math.min(1, dot / (Math.sqrt(normA) * Math.sqrt(normB))));
}

export async function embedText(text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const model = getEmbedModel();
  const cacheKey = embeddingCacheKey(model, trimmed);
  const cached = getCachedEmbedding(cacheKey);
  if (cached) return cached;

  let response: Response;
  try {
    response = await fetchOllama(getOllamaBaseUrl(), "/api/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: trimmed,
      }),
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : `Impossible de contacter Ollama pour les embeddings (${getOllamaBaseUrl()}).`,
    );
  }

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `Échec embeddings Ollama (${response.status}). ` +
        `Installez le modèle: ollama pull ${model}` +
        (details ? ` — ${details.slice(0, 160)}` : ""),
    );
  }

  const payload = (await response.json()) as { embedding?: number[] };
  const embedding = payload.embedding ?? [];
  if (embedding.length === 0) {
    throw new Error("Ollama a renvoyé un embedding vide.");
  }

  setCachedEmbedding(cacheKey, embedding);
  return embedding;
}

export async function semanticSimilarity(
  a: string,
  b: string,
): Promise<number> {
  const left = a.trim();
  const right = b.trim();
  if (!left && !right) return 1;
  if (!left || !right) return 0;

  const [embedA, embedB] = await Promise.all([
    embedText(left),
    embedText(right),
  ]);

  return cosineSimilarity(embedA, embedB);
}

export async function ensureEmbeddingModel(): Promise<void> {
  await embedText("contrôle embeddings docmind");
}
