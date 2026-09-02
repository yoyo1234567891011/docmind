/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  DocMind — CONFIGURATION UNIQUE                                          ║
 * ║  Édite CE FICHIER uniquement. Ne disperse plus les réglages ailleurs.    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Après modification : redémarrer `npm run dev` (et éventuellement rafraîchir Admin).
 */

export type ModelProfileId = "qwen" | "llama" | "mistral" | "deepseek";
export type ChatTaskId = "classify" | "analyze" | "reply" | "searchIntent";
export type PromptKey =
  | "classification"
  | "analysis"
  | "reply"
  | "searchIntent";

export interface ModelProfileTaskOverride {
  model?: string;
  temperature?: number;
  /** Max tokens générés (Ollama num_predict). */
  maxTokens?: number;
}

export interface ModelProfile {
  label: string;
  description: string;
  chat: string;
  embed: string;
  tasks?: Partial<Record<ChatTaskId, ModelProfileTaskOverride>>;
}

export const DOCUMENT_CATEGORY_IDS = [
  "contrat",
  "facture",
  "assurance",
  "banque",
  "impots",
  "bail",
  "courrier-administratif",
  "contrat-de-travail",
  "conditions-generales",
  "autre",
] as const;

export type DocumentCategoryId = (typeof DOCUMENT_CATEGORY_IDS)[number];

/**
 * ▶ TOUTE LA CONFIG APP — modifier ici
 */
export const docmindConfig = {
  /* ─── Ollama / modèles ───────────────────────────────────────────────── */
  ollama: {
    /** URL de l’instance Ollama locale */
    baseUrl: "http://127.0.0.1:11434",

    /**
     * Profil actif : "qwen" | "llama" | "mistral" | "deepseek"
     * (surchargeable par env OLLAMA_PROFILE)
     * mistral = bien plus rapide que qwen3 en local.
     */
    activeProfile: "mistral" as ModelProfileId,

    /** Longueur max de génération par défaut (tokens). */
    maxTokens: 1400,

    /**
     * Cloud (Groq) : completion tokens.
     * Free tier TPM ~8k : trop haut (ex. 2200) + long bail ≈ requête refusée.
     * 1200 suffit pour le JSON core-bundle ; moins de TPM consommé.
     */
    cloudAnalyzeMaxTokens: 1400,

    /**
     * Fenêtre de contexte Ollama. Plus bas = prompt_eval plus rapide
     * (assez pour prompt compact + extrait document ~8k car.).
     */
    numCtx: 8192,

    /**
     * Timeout hard sur un appel /api/generate (ms).
     * Doit rester < maxDuration Vercel Hobby (300s) — marge pour PG/historique.
     * Surcharge : OLLAMA_GENERATE_TIMEOUT_MS.
     */
    generateTimeoutMs: 270_000,

    /**
     * Si true : pas de 3ᵉ appel LLM « réponse prête » à chaque analyse
     * (gros gain de temps). Activable plus tard à la demande.
     */
    skipReadyReplyByDefault: true,

    /**
     * Si true : classification 100 % locale (mots-clés), sans appel LLM.
     * Plus fiable et plus rapide ; le prompt d'analyse reste spécialisé.
     */
    skipLlmClassifyByDefault: true,

    /** Températures par défaut si non précisées dans le profil. */
    defaultTemperatures: {
      classify: 0,
      analyze: 0,
      reply: 0.3,
      searchIntent: 0,
    } satisfies Record<ChatTaskId, number>,

    /** Profils nommés pour A/B tester facilement. */
    profiles: {
      qwen: {
        label: "Qwen",
        description: "Bon équilibre FR / JSON — plus lent",
        chat: "qwen3",
        embed: "nomic-embed-text",
        tasks: {
          classify: { temperature: 0, maxTokens: 64 },
          analyze: { temperature: 0, maxTokens: 1400 },
          reply: { temperature: 0.3, maxTokens: 1200 },
          searchIntent: { temperature: 0, maxTokens: 300 },
        },
      },
      llama: {
        label: "Llama",
        description: "Meta Llama — polyvalent",
        chat: "llama3.2",
        embed: "nomic-embed-text",
        tasks: {
          classify: { temperature: 0, maxTokens: 64 },
          analyze: { temperature: 0, maxTokens: 1400 },
          reply: { temperature: 0.3, maxTokens: 1200 },
          searchIntent: { temperature: 0, maxTokens: 300 },
        },
      },
      mistral: {
        label: "Mistral",
        description: "Rapide (recommandé pour usage local)",
        chat: "mistral",
        embed: "nomic-embed-text",
        tasks: {
          classify: { temperature: 0, maxTokens: 64 },
          analyze: { temperature: 0, maxTokens: 1400 },
          reply: { temperature: 0.25, maxTokens: 1200 },
          searchIntent: { temperature: 0, maxTokens: 300 },
        },
      },
      deepseek: {
        label: "DeepSeek",
        description: "Fort en raisonnement — plus lent",
        chat: "deepseek-r1",
        embed: "nomic-embed-text",
        tasks: {
          classify: { temperature: 0, maxTokens: 64 },
          analyze: { temperature: 0, maxTokens: 1400 },
          reply: { temperature: 0.3, maxTokens: 1200 },
          searchIntent: { temperature: 0, maxTokens: 300 },
        },
      },
    } satisfies Record<ModelProfileId, ModelProfile>,
  },

  /* ─── Prompts actifs (null = builder code ; sinon id version Admin) ───── */
  prompts: {
    /**
     * IDs de versions Admin à activer au démarrage (si présents dans
     * data/admin/prompts.json). Laisse null pour le prompt code.
     * L’Admin peut toujours surcharger ensuite.
     */
    activeByKey: {
      classification: null as string | null,
      analysis: null as string | null,
      reply: null as string | null,
      searchIntent: null as string | null,
    } satisfies Record<PromptKey, string | null>,
  },

  /* ─── Catégories de documents ────────────────────────────────────────── */
  categories: {
    ids: DOCUMENT_CATEGORY_IDS,
    labels: {
      contrat: "Contrat",
      facture: "Facture",
      assurance: "Assurance",
      banque: "Banque",
      impots: "Impôts",
      bail: "Bail",
      "courrier-administratif": "Courrier administratif",
      "contrat-de-travail": "Contrat de travail",
      "conditions-generales": "Conditions générales",
      autre: "Autre",
    } satisfies Record<DocumentCategoryId, string>,
    /** Catégorie de repli si la classification échoue. */
    fallback: "autre" as DocumentCategoryId,
  },

  /* ─── Seuils de confiance / évaluation ───────────────────────────────── */
  thresholds: {
    /** Sous ce score, on force la catégorie fallback. */
    classificationMinConfidence: 0.35,
    /** Confiance affichée si le modèle n’en fournit pas. */
    classificationDefaultConfidence: 0,
    /** Similarité embeddings — équivalent. */
    semanticEquivalent: 0.78,
    /** Similarité embeddings — partiel. */
    semanticPartial: 0.62,
    /** Match d’item dans un tableau sémantique. */
    semanticArrayMatch: 0.7,
    /** Match partiel d’item dans un tableau sémantique. */
    semanticArrayPartial: 0.55,
    /** Tolérance score de risque (points) pour l’eval numérique. */
    riskScoreTolerance: 15,
  },

  /* ─── Upload / produit ───────────────────────────────────────────────── */
  upload: {
    maxSizeBytes: 10 * 1024 * 1024,
    acceptedMimeTypes: ["application/pdf"] as const,
  },

  site: {
    name: "DocMind",
    description:
      "Analysez vos PDF avec une IA locale : résumé, points clés, risques et actions.",
    locale: "fr-FR",
  },

  /* ─── Auth (redirects ; secrets via env) ─────────────────────────────── */
  auth: {
    loginPath: "/auth/login",
    afterLoginPath: "/dashboard",
    callbackPath: "/auth/callback",
    /** UserId technique pour les runs d’évaluation (EVAL_API_KEY). */
    evalUserId: "eval-runner",
  },
} as const;

export type DocmindConfig = typeof docmindConfig;

/* ─── Helpers (consommer la config, ne pas dupliquer les valeurs) ──────── */

export function getActiveModelProfileId(): ModelProfileId {
  const fromEnv = process.env.OLLAMA_PROFILE?.trim() as ModelProfileId | undefined;
  if (fromEnv && fromEnv in docmindConfig.ollama.profiles) {
    return fromEnv;
  }
  return docmindConfig.ollama.activeProfile;
}

export function getActiveModelProfile(): ModelProfile {
  return docmindConfig.ollama.profiles[getActiveModelProfileId()];
}

export function resolveProfileChatModel(
  profile: ModelProfile,
  task: ChatTaskId,
): string {
  return profile.tasks?.[task]?.model?.trim() || profile.chat;
}

export function resolveProfileTemperature(
  profile: ModelProfile,
  task: ChatTaskId,
): number {
  const fromTask = profile.tasks?.[task]?.temperature;
  if (typeof fromTask === "number") return fromTask;
  return docmindConfig.ollama.defaultTemperatures[task];
}

export function resolveProfileMaxTokens(
  profile: ModelProfile,
  task: ChatTaskId,
): number {
  const fromTask = profile.tasks?.[task]?.maxTokens;
  if (typeof fromTask === "number" && fromTask > 0) return fromTask;
  return docmindConfig.ollama.maxTokens;
}

export const MODEL_PROFILE_IDS = Object.keys(
  docmindConfig.ollama.profiles,
) as ModelProfileId[];

/** @deprecated Use getActiveModelProfileId — alias for older imports */
export const ACTIVE_MODEL_PROFILE = docmindConfig.ollama.activeProfile;

/** @deprecated Use docmindConfig.ollama.profiles */
export const MODEL_PROFILES = docmindConfig.ollama.profiles;
