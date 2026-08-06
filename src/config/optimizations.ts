/**
 * Optimisations P0 — interrupteurs indépendants.
 * Désactiver via ce fichier ou via env :
 *   OPT_ANALYSIS_CACHE=0
 *   OPT_CONDITIONAL_JSON_RETRY=0
 *   OPT_OLLAMA_KEEP_ALIVE=0
 *   OPT_REASONING_MODE=0
 *   OPT_AGENT_FAST=0   (désactive le bundle 1 LLM → chaîne full 4 LLM)
 *   OPT_KNOWLEDGE=0    (désactive l'injection /knowledge)
 */

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(v)) return false;
  if (["1", "true", "on", "yes"].includes(v)) return true;
  return fallback;
}

/**
 * ▶ Réglages par défaut (modifiables ici).
 * Les variables d'environnement ci-dessus ont priorité.
 */
const defaults = {
  analysisCache: {
    /** Cache disque du résultat d'analyse (clé = hash du texte). */
    enabled: true,
    /** TTL des entrées (ms). */
    ttlMs: 7 * 24 * 60 * 60 * 1000,
    /** Nombre max d'entrées conservées. */
    maxEntries: 200,
  },
  conditionalJsonRetry: {
    /**
     * Si true : ne retente le LLM que si le 1er JSON est invalide
     * ET que l'extraction locale n'a pas assez de signaux.
     */
    enabled: true,
    /** Seuil de signaux locaux (montants + échéances + dates) pour skip retry. */
    minLocalSignalsToSkipRetry: 2,
  },
  ollamaKeepAlive: {
    /** Garde le modèle chat en mémoire (Ollama keep_alive). */
    enabled: true,
    /** Durée Ollama (ex. "30m", "1h") ou secondes. */
    duration: "30m" as string | number,
  },
  reasoningMode: {
    /**
     * Analyse par raisonnement (findings + auto-vérif serveur).
     * Si false : scoring regex historique (mots-clés).
     */
    enabled: true,
    /** Confiance mini pour confirmer un risque (sinon ambiguous). */
    minConfidenceConfirmed: 0.55,
  },
  agentFastMode: {
    /**
     * true : 1 appel LLM multi-spécialités + score/verify (rapide).
     * false : 1 appel LLM par agent (plus lent, plus isolé).
     */
    enabled: true,
  },
  knowledgeBase: {
    /** Injecte les fiches /knowledge dans les prompts d'analyse. */
    enabled: true,
  },
} as const;

export type OptimizationConfig = {
  analysisCache: {
    enabled: boolean;
    ttlMs: number;
    maxEntries: number;
  };
  conditionalJsonRetry: {
    enabled: boolean;
    minLocalSignalsToSkipRetry: number;
  };
  ollamaKeepAlive: {
    enabled: boolean;
    duration: string | number;
  };
  reasoningMode: {
    enabled: boolean;
    minConfidenceConfirmed: number;
  };
  agentFastMode: {
    enabled: boolean;
  };
  knowledgeBase: {
    enabled: boolean;
  };
};

export function getOptimizationConfig(): OptimizationConfig {
  return {
    analysisCache: {
      enabled: envFlag(
        "OPT_ANALYSIS_CACHE",
        defaults.analysisCache.enabled,
      ),
      ttlMs: defaults.analysisCache.ttlMs,
      maxEntries: defaults.analysisCache.maxEntries,
    },
    conditionalJsonRetry: {
      enabled: envFlag(
        "OPT_CONDITIONAL_JSON_RETRY",
        defaults.conditionalJsonRetry.enabled,
      ),
      minLocalSignalsToSkipRetry:
        defaults.conditionalJsonRetry.minLocalSignalsToSkipRetry,
    },
    ollamaKeepAlive: {
      enabled: envFlag(
        "OPT_OLLAMA_KEEP_ALIVE",
        defaults.ollamaKeepAlive.enabled,
      ),
      duration: defaults.ollamaKeepAlive.duration,
    },
    reasoningMode: {
      enabled: envFlag(
        "OPT_REASONING_MODE",
        defaults.reasoningMode.enabled,
      ),
      minConfidenceConfirmed: defaults.reasoningMode.minConfidenceConfirmed,
    },
    agentFastMode: {
      enabled: envFlag(
        "OPT_AGENT_FAST",
        defaults.agentFastMode.enabled,
      ),
    },
    knowledgeBase: {
      enabled: envFlag(
        "OPT_KNOWLEDGE",
        defaults.knowledgeBase.enabled,
      ),
    },
  };
}

export function isKnowledgeBaseEnabled(): boolean {
  return getOptimizationConfig().knowledgeBase.enabled;
}

export function isReasoningModeEnabled(): boolean {
  return getOptimizationConfig().reasoningMode.enabled;
}

/** Snapshot figé des defaults code (pour rapports / tests). */
export const optimizationDefaults = defaults;
