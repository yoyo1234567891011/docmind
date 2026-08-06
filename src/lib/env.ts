function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export const env = {
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "qwen3",
  ollamaEmbedModel: process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text",
  nodeEnv: process.env.NODE_ENV ?? "development",
  get isProduction() {
    return this.nodeEnv === "production";
  },
} as const;

export function getRequiredOllamaConfig() {
  return {
    baseUrl: requireEnv("OLLAMA_BASE_URL", process.env.OLLAMA_BASE_URL),
    model: requireEnv("OLLAMA_MODEL", process.env.OLLAMA_MODEL),
  };
}
