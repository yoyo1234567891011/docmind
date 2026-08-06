import { getOptimizationConfig } from "@/config/optimizations";

/**
 * Valeur `keep_alive` Ollama, ou undefined si l'optimisation est OFF.
 * Module indépendant — à injecter dans le payload /api/generate uniquement.
 */
export function resolveOllamaKeepAlive(): string | number | undefined {
  const config = getOptimizationConfig().ollamaKeepAlive;
  if (!config.enabled) return undefined;
  return config.duration;
}

export function isOllamaKeepAliveEnabled(): boolean {
  return getOptimizationConfig().ollamaKeepAlive.enabled;
}
