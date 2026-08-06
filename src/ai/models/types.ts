export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  /**
   * Disable chain-of-thought for thinking models (qwen3, etc.).
   * Top-level Ollama field — not inside `options`.
   */
  think?: boolean;
  /** Force JSON mode (Ollama native). */
  format?: "json" | Record<string, unknown>;
  /** Garde le modèle chargé (ex. "30m"). */
  keep_alive?: string | number;
  options?: {
    temperature?: number;
    num_predict?: number;
    /** Fenêtre de contexte — plus bas = prompt_eval plus rapide. */
    num_ctx?: number;
  };
}

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  total_duration?: number;
  eval_count?: number;
  prompt_eval_count?: number;
}

export interface OllamaGenerateOptions {
  prompt: string;
  /** Override model; defaults to task config when using generateForTask */
  model?: string;
  temperature?: number;
  /** Max generated tokens (Ollama num_predict) */
  maxTokens?: number;
  /** Override Ollama base URL (Admin runtime) */
  baseUrl?: string;
  /** Force JSON object response from Ollama */
  formatJson?: boolean;
  /** Override Ollama num_ctx (default from docmindConfig). */
  numCtx?: number;
  /** Override hard timeout (ms) for this generate call. */
  timeoutMs?: number;
}

/** Normalized generate result with token usage. */
export interface OllamaGenerateResult {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
}
