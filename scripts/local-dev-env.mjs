/**
 * Isolation LOCAL pour `npm run dev` — empêche les écritures cloud/bêta accidentelles.
 *
 * Par défaut : FS local, Ollama, pas de PG/S3/Redis/Stripe/Supabase.
 * Opt-in cloud bêta : DOCMIND_CLOUD_BETA=1 (charge .env.cloud-beta.local)
 */
import fs from "fs";
import path from "path";

const CLOUD_BACKEND_KEYS = [
  "DATABASE_URL",
  "REDIS_URL",
  "KV_URL",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "KV_REST_API_READ_ONLY_TOKEN",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_ENDPOINT",
  "S3_REGION",
  "AWS_REGION",
  "S3_SESSION_TOKEN",
  "S3_FORCE_PATH_STYLE",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "STRIPE_PRICE_BASIQUE",
  "STRIPE_PRICE_PRO",
  "STRIPE_PRICE_PREMIUM",
  "STRIPE_PRICE_EXTRA",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GROQ_API_KEY",
  "LLM_API_KEY",
  "MISTRAL_API_KEY",
  "LLM_API_BASE_URL",
  "LLM_MODEL",
];

function loadDotenvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function blankCloudBackends(env) {
  for (const key of CLOUD_BACKEND_KEYS) {
    env[key] = "";
  }
  env.LLM_PROVIDER = "ollama";
  env.NEXT_PUBLIC_SUPABASE_URL = "";
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";
  env.SUPABASE_SERVICE_ROLE_KEY = "";
  env.DOCMIND_STORAGE = "fs";
  env.DOCMIND_FS_FALLBACK = "0";
  env.DOCMIND_FS_DUAL_WRITE = "0";
  env.NEXT_PUBLIC_APP_ENV = "development";
  env.BILLING_ENTITLEMENTS_FAIL_OPEN = "1";
  if (!env.DOCMIND_DATA_DIR?.trim()) {
    env.DOCMIND_DATA_DIR = "data";
  }
}

/**
 * @param {Record<string, string | undefined>} base
 * @returns {Record<string, string>}
 */
export function buildLocalDevEnv(base = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === "string") env[key] = value;
  }

  if (env.DOCMIND_CLOUD_BETA === "1") {
    loadDotenvFile(path.join(process.cwd(), ".env.cloud-beta.local"));
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string" && value) env[key] = value;
    }
    console.log(
      "[docmind:dev] Mode cloud-bêta explicite (DOCMIND_CLOUD_BETA=1) — PG/S3/Redis actifs si configurés.",
    );
    return env;
  }

  blankCloudBackends(env);
  if (env.NEXT_PUBLIC_APP_URL?.match(/vercel\.app/i)) {
    env.NEXT_PUBLIC_APP_URL = `http://127.0.0.1:${env.PORT || "3000"}`;
  }
  console.log(
    "[docmind:dev] Mode LOCAL isolé — FS + Ollama · cloud/PG/S3/Stripe/Supabase désactivés. " +
      "Pour tester contre cloud bêta : DOCMIND_CLOUD_BETA=1 npm run dev",
  );
  return env;
}
