/**
 * Estimation de coût par analyse.
 * Ollama local ≈ coût électricité/GPU ; ajustable via env.
 */
function numEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const analyticsCostConfig = {
  /** Coût EUR d’une heure GPU/CPU d’inférence (proxy). */
  gpuHourEur: numEnv("ANALYTICS_GPU_HOUR_EUR", 0.12),
  /** Coût EUR pour 1M tokens prompt+completion (0 si purement local). */
  tokenMillionEur: numEnv("ANALYTICS_TOKEN_MILLION_EUR", 0),
};

export function estimateAnalysisCostEur(input: {
  durationMs?: number | null;
  totalTokens?: number | null;
}): number {
  const hours = Math.max(0, input.durationMs ?? 0) / 3_600_000;
  const tokenCost =
    (Math.max(0, input.totalTokens ?? 0) / 1_000_000) *
    analyticsCostConfig.tokenMillionEur;
  const gpuCost = hours * analyticsCostConfig.gpuHourEur;
  return Math.round((gpuCost + tokenCost) * 10_000) / 10_000;
}
