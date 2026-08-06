import { getOptimizationConfig } from "@/config/optimizations";
import { extractDocumentEntities } from "@/ai/extraction";

export interface ConditionalRetryInput {
  /** La 1ʳᵉ génération LLM a renvoyé du texte. */
  firstGenerationOk: boolean;
  /** Parse JSON de la 1ʳᵉ réponse (null = invalide). */
  parsedOk: boolean;
  /** Texte document (pour compter les signaux locaux). */
  documentText: string;
}

/**
 * Décide si un 2ᵉ appel LLM (retry JSON) est pertinent.
 * Si désactivé → comportement historique : retry dès que parse KO + 1ʳᵉ OK.
 */
export function shouldRetryJsonAnalysis(input: ConditionalRetryInput): boolean {
  if (!input.firstGenerationOk || input.parsedOk) return false;

  const config = getOptimizationConfig().conditionalJsonRetry;
  if (!config.enabled) {
    // Opt OFF = toujours retenter (comportement d'origine)
    return true;
  }

  const entities = extractDocumentEntities(input.documentText);
  const localSignals =
    entities.amounts.length +
    entities.deadlines.length +
    (entities.primaryDate ? 1 : 0);

  // Assez de matière locale → skip retry coûteux, le salvage/enrich suffira
  if (localSignals >= config.minLocalSignalsToSkipRetry) {
    return false;
  }

  return true;
}

export function isConditionalJsonRetryEnabled(): boolean {
  return getOptimizationConfig().conditionalJsonRetry.enabled;
}

/** Compte les signaux locaux (exposé pour benches / tests). */
export function countLocalSignals(documentText: string): number {
  const entities = extractDocumentEntities(documentText);
  return (
    entities.amounts.length +
    entities.deadlines.length +
    (entities.primaryDate ? 1 : 0)
  );
}
