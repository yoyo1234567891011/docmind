import { generateForTask } from "@/ai/models";
import type { OllamaGenerateResult } from "@/ai/models/types";
import { tryParseJsonObject } from "@/ai/validation/json";

/** Appel LLM pour un agent spécialisé (réutilise la config tâche analyze). */
export async function generateAgentJson(
  prompt: string,
  options?: { maxTokens?: number },
): Promise<{ generation: OllamaGenerateResult | null; error?: string }> {
  try {
    const generation = await generateForTask("analyze", prompt, options);
    return { generation };
  } catch (error) {
    return {
      generation: null,
      error:
        error instanceof Error
          ? error.message
          : "Échec appel modèle agent",
    };
  }
}

export function parseAgentJson<T extends object>(
  raw: string | undefined | null,
): T | null {
  if (!raw) return null;
  return tryParseJsonObject<T>(raw);
}
