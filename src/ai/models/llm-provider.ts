/**
 * Résolution du backend LLM : Ollama local vs API OpenAI-compatible (Groq / Mistral…).
 * Cloud actif dès qu’une clé est présente (Vercel beta/prod sans tunnel PC).
 */

export type LlmProviderKind = "ollama" | "openai_compatible";

export type CloudLlmConfig = {
  kind: "openai_compatible";
  baseUrl: string;
  apiKey: string;
  /** Modèle chat cloud (override OLLAMA_MODEL / profil). */
  model: string;
};

export type OllamaLlmConfig = {
  kind: "ollama";
};

export type LlmProviderConfig = CloudLlmConfig | OllamaLlmConfig;

function trimEnv(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

/** Clé API cloud : LLM_API_KEY | GROQ_API_KEY | MISTRAL_API_KEY */
export function resolveCloudApiKey(): string | undefined {
  return (
    trimEnv("LLM_API_KEY") ||
    trimEnv("GROQ_API_KEY") ||
    trimEnv("MISTRAL_API_KEY")
  );
}

function resolveCloudBaseUrl(apiKeySource: "groq" | "mistral" | "generic"): string {
  const fromEnv = trimEnv("LLM_API_BASE_URL");
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (apiKeySource === "mistral") return "https://api.mistral.ai/v1";
  // Groq (défaut recommandé) ou générique → Groq
  return "https://api.groq.com/openai/v1";
}

/**
 * Modèles Groq retirés (shutdown 2026-08-16) → remplacement automatique.
 * @see https://console.groq.com/docs/deprecations
 */
const GROQ_RETIRED_MODEL_MAP: Record<string, string> = {
  "llama-3.3-70b-versatile": "qwen/qwen3.6-27b",
  "llama-3.1-8b-instant": "openai/gpt-oss-20b",
};

/** Normalise un id modèle cloud (remap des modèles Groq retirés). */
export function normalizeCloudModelId(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return trimmed;
  const key = trimmed.toLowerCase();
  const replacement = GROQ_RETIRED_MODEL_MAP[key];
  if (replacement) {
    console.warn(
      `[llm] modèle Groq retiré ${trimmed} → ${replacement} (mise à jour LLM_MODEL recommandée)`,
    );
    return replacement;
  }
  return trimmed;
}

function resolveCloudModel(apiKeySource: "groq" | "mistral" | "generic"): string {
  const fromEnv = trimEnv("LLM_MODEL");
  if (fromEnv) return normalizeCloudModelId(fromEnv);
  if (apiKeySource === "mistral") return "mistral-small-latest";
  // Défaut Groq (post-dépréciation llama-3.x, sept. 2026)
  return "openai/gpt-oss-120b";
}

function detectApiKeySource(): "groq" | "mistral" | "generic" | null {
  if (trimEnv("LLM_API_KEY")) return "generic";
  if (trimEnv("GROQ_API_KEY")) return "groq";
  if (trimEnv("MISTRAL_API_KEY")) return "mistral";
  return null;
}

/**
 * Force ollama si LLM_PROVIDER=ollama ; sinon cloud dès qu’une clé existe.
 * LLM_PROVIDER=openai_compatible sans clé → fallback ollama (évite crash boot/generate).
 */
export function getLlmProviderConfig(): LlmProviderConfig {
  const forced = trimEnv("LLM_PROVIDER")?.toLowerCase();
  if (forced === "ollama") return { kind: "ollama" };

  const source = detectApiKeySource();
  const apiKey = resolveCloudApiKey();

  if (apiKey && source) {
    return {
      kind: "openai_compatible",
      baseUrl: resolveCloudBaseUrl(source),
      apiKey,
      model: resolveCloudModel(source),
    };
  }

  if (forced === "openai_compatible" || forced === "cloud") {
    console.warn(
      "[llm] LLM_PROVIDER=openai_compatible mais aucune clé — fallback Ollama.",
    );
  }

  return { kind: "ollama" };
}

export function isCloudLlmEnabled(): boolean {
  try {
    return getLlmProviderConfig().kind === "openai_compatible";
  } catch {
    return false;
  }
}
