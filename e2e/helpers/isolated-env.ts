/**
 * Environnement E2E isolé — LOCAL (Ollama) ou STAGING (cloud).
 * Coupe toujours PG / S3 / Redis / Stripe / Supabase hérités (pas de prod).
 */
import {
  assertNotProductionContamination,
  LOCAL_OLLAMA_MODEL,
  resolveE2eTarget,
  resolveStagingCloudApiKey,
  STAGING_CLOUD_BASE,
  STAGING_CLOUD_MODEL,
  type E2eTarget,
} from "./env-target";

function blankPersistentBackends(base: Record<string, string>): void {
  Object.assign(base, {
    DATABASE_URL: "",
    REDIS_URL: "",
    KV_URL: "",
    KV_REST_API_URL: "",
    KV_REST_API_TOKEN: "",
    KV_REST_API_READ_ONLY_TOKEN: "",
    S3_BUCKET: "",
    S3_ACCESS_KEY_ID: "",
    S3_SECRET_ACCESS_KEY: "",
    S3_ENDPOINT: "",
    S3_REGION: "",
    AWS_REGION: "",
    S3_SESSION_TOKEN: "",
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "",
    STRIPE_PRICE_BASIQUE: "",
    STRIPE_PRICE_PRO: "",
    STRIPE_PRICE_PREMIUM: "",
    STRIPE_PRICE_EXTRA: "",
  });
}

function applyLocalLlm(base: Record<string, string>): void {
  Object.assign(base, {
    LLM_PROVIDER: "ollama",
    OLLAMA_BASE_URL: "http://127.0.0.1:11434",
    OLLAMA_MODEL: LOCAL_OLLAMA_MODEL,
    OLLAMA_MODEL_CLASSIFY: LOCAL_OLLAMA_MODEL,
    OLLAMA_MODEL_ANALYZE: LOCAL_OLLAMA_MODEL,
    OLLAMA_MODEL_REPLY: LOCAL_OLLAMA_MODEL,
    OLLAMA_MODEL_SEARCH: LOCAL_OLLAMA_MODEL,
    OLLAMA_GENERATE_TIMEOUT_MS: "600000",
    E2E_REQUIRE_OLLAMA: "1",
    GROQ_API_KEY: "",
    LLM_API_KEY: "",
    MISTRAL_API_KEY: "",
    LLM_MODEL: "",
    LLM_API_BASE_URL: "",
  });
}

function applyStagingLlm(base: Record<string, string>): void {
  const apiKey = resolveStagingCloudApiKey();
  Object.assign(base, {
    // Identifiant logique — pas un deploy Vercel staging
    E2E_TARGET: "staging",
    DOCMIND_E2E_PROFILE: "staging",
    LLM_PROVIDER: "openai_compatible",
    LLM_API_BASE_URL: STAGING_CLOUD_BASE,
    LLM_MODEL: STAGING_CLOUD_MODEL,
    GROQ_API_KEY: apiKey,
    LLM_API_KEY: "",
    MISTRAL_API_KEY: "",
    // Couper Ollama pour éviter un fallback local OOM
    OLLAMA_BASE_URL: "",
    OLLAMA_MODEL: "",
    OLLAMA_MODEL_CLASSIFY: "",
    OLLAMA_MODEL_ANALYZE: "",
    OLLAMA_MODEL_REPLY: "",
    OLLAMA_MODEL_SEARCH: "",
    E2E_REQUIRE_OLLAMA: "0",
  });
}

/**
 * Environnement serveur Next pour Playwright.
 * @default target from E2E_TARGET (local)
 */
export function e2eIsolatedServerEnv(
  extras: Record<string, string> = {},
  target: E2eTarget = resolveE2eTarget(),
): Record<string, string> {
  const useSupabase = process.env.PLAYWRIGHT_USE_SUPABASE === "1";

  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") base[key] = value;
  }

  Object.assign(base, {
    // Toujours development au boot : staging « déployé » exigerait persistent PG.
    // Le profil E2E staging est porté par E2E_TARGET / DOCMIND_E2E_PROFILE.
    NEXT_PUBLIC_APP_ENV: "development",
    NODE_ENV: "development",
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || 3010}`,
    DOCMIND_STORAGE: "fs",
    DOCMIND_FS_FALLBACK: "0",
    DOCMIND_FS_DUAL_WRITE: "0",
    DOCMIND_DATA_DIR: process.env.DOCMIND_E2E_DATA_DIR || "data-e2e",
    DOCMIND_SKIP_ENV_ASSERT: "1",
    DOCMIND_E2E: "1",
    E2E_TARGET: target,
    DOCMIND_DIST_DIR: process.env.DOCMIND_DIST_DIR || ".next-e2e",
    BILLING_ENTITLEMENTS_FAIL_OPEN: "1",
    QUOTA_FREE_UPLOAD: "10000",
    QUOTA_FREE_ANALYZE: "10000",
    // Même utilisateur que le navigateur (local-dev) — pas eval-runner.
    EVAL_API_KEY: "",
  });

  blankPersistentBackends(base);

  if (target === "staging") {
    applyStagingLlm(base);
  } else {
    applyLocalLlm(base);
  }

  if (!useSupabase) {
    base.NEXT_PUBLIC_SUPABASE_URL = "";
    base.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";
    base.SUPABASE_SERVICE_ROLE_KEY = "";
  }

  Object.assign(base, extras);
  assertNotProductionContamination(base);
  return base;
}
