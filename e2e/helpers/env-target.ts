/**
 * Cible E2E — séparation stricte LOCAL / STAGING / (jamais PRODUCTION).
 *
 * E2E_TARGET=local   → Ollama gpt-oss:120b (machine locale)
 * E2E_TARGET=staging → API cloud openai/gpt-oss-120b (données FS isolées)
 *
 * PRODUCTION est refusée.
 */
import fs from "fs";
import path from "path";

export type E2eTarget = "local" | "staging";

/** Modèle Ollama local (tag exact). */
export const LOCAL_OLLAMA_MODEL = "gpt-oss:120b";

/**
 * Modèle Groq / OpenAI-compatible aligné sur la prod/bêta Vercel
 * (voir .env.vercel.production LLM_MODEL) — utilisé UNIQUEMENT en E2E staging.
 */
export const STAGING_CLOUD_MODEL = "openai/gpt-oss-120b";
export const STAGING_CLOUD_BASE = "https://api.groq.com/openai/v1";

export function resolveE2eTarget(): E2eTarget {
  const raw = (process.env.E2E_TARGET || "local").trim().toLowerCase();
  if (raw === "production" || raw === "prod" || raw === "beta") {
    throw new Error(
      `E2E_TARGET=« ${raw} » interdit. Les E2E ne doivent jamais cibler la production/bêta déployée. ` +
        `Utilisez E2E_TARGET=local ou E2E_TARGET=staging.`,
    );
  }
  if (raw === "staging" || raw === "e2e-staging" || raw === "cloud") {
    return "staging";
  }
  if (raw === "local" || raw === "ollama" || raw === "") {
    return "local";
  }
  throw new Error(
    `E2E_TARGET=« ${raw} » inconnu. Valeurs autorisées : local | staging.`,
  );
}

/** Charge `.env.e2e.staging.local` dans process.env (sans écraser les déjà définies). */
export function loadStagingE2eDotenv(): void {
  const filePath = path.join(process.cwd(), ".env.e2e.staging.local");
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
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

export function assertNotProductionContamination(env: Record<string, string>): void {
  const appEnv = (env.NEXT_PUBLIC_APP_ENV || "").toLowerCase();
  if (appEnv === "production") {
    throw new Error(
      "Refus E2E : NEXT_PUBLIC_APP_ENV=production. Aucun test ne doit écrire en production.",
    );
  }
  if (env.DOCMIND_STORAGE === "persistent" && env.DATABASE_URL?.trim()) {
    throw new Error(
      "Refus E2E : storage persistent + DATABASE_URL. " +
        "Les E2E isolés doivent rester en DOCMIND_STORAGE=fs sans PG/S3 (évite la contamination cloud).",
    );
  }
  const appUrl = env.NEXT_PUBLIC_APP_URL || "";
  if (/docmind-blond\.vercel\.app/i.test(appUrl)) {
    throw new Error(
      "Refus E2E : NEXT_PUBLIC_APP_URL pointe vers l’hôte production/bêta Vercel. " +
        "Utilisez http://127.0.0.1:<port> uniquement.",
    );
  }
}

export function resolveStagingCloudApiKey(): string {
  loadStagingE2eDotenv();
  const key =
    process.env.E2E_STAGING_GROQ_API_KEY?.trim() ||
    process.env.E2E_STAGING_LLM_API_KEY?.trim() ||
    "";
  if (!key) {
    throw new Error(
      "E2E staging : aucune clé cloud. Créez `.env.e2e.staging.local` avec " +
        "E2E_STAGING_GROQ_API_KEY=... (voir .env.e2e.staging.example). " +
        "Ne pas dériver depuis .env.local / GROQ_API_KEY — clé staging dédiée uniquement.",
    );
  }
  return key;
}
