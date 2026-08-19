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

function resolveCloudModel(apiKeySource: "groq" | "mistral" | "generic"): string {
  const fromEnv = trimEnv("LLM_MODEL");
  if (fromEnv) return fromEnv;
  if (apiKeySource === "mistral") return "mistral-small-latest";
  return "llama-3.1-8b-instant";
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
