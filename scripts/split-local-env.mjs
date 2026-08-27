/**
 * Sépare .env.local en :
 * - .env.local (LOCAL isolé — chargé par npm run dev)
 * - .env.cloud-beta.local (opt-in cloud bêta — gitignored)
 *
 * Usage: node scripts/split-local-env.mjs
 * Ne logue jamais les valeurs secrètes.
 */
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const LOCAL_FILE = path.join(ROOT, ".env.local");
const CLOUD_FILE = path.join(ROOT, ".env.cloud-beta.local");
const BACKUP = path.join(ROOT, ".env.local.bak-before-split");

const CLOUD_KEYS = new Set([
  "NEXT_PUBLIC_APP_ENV",
  "DOCMIND_STORAGE",
  "DOCMIND_FS_FALLBACK",
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
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "GROQ_API_KEY",
  "LLM_PROVIDER",
  "LLM_API_KEY",
  "LLM_API_BASE_URL",
  "LLM_MODEL",
  "PG_SSL_REJECT_UNAUTHORIZED",
]);

function parseEnv(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      entries.push({ kind: "comment", raw: line });
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      entries.push({ kind: "comment", raw: line });
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    entries.push({ kind: "var", key, value, raw: line });
  }
  return entries;
}

function main() {
  if (!fs.existsSync(LOCAL_FILE)) {
    console.error(".env.local introuvable.");
    process.exit(1);
  }
  const original = fs.readFileSync(LOCAL_FILE, "utf8");
  if (!fs.existsSync(BACKUP)) {
    fs.writeFileSync(BACKUP, original, "utf8");
    console.log(`Backup: ${path.basename(BACKUP)}`);
  }

  const entries = parseEnv(original);
  const cloudLines = [
    "# Cloud bêta — opt-in uniquement (DOCMIND_CLOUD_BETA=1 npm run dev)",
    "# NE PAS utiliser pour npm run dev standard.",
    "",
  ];
  const localLines = [
    "# DocMind — développement LOCAL isolé (npm run dev)",
    "# Cloud bêta : voir .env.cloud-beta.local + DOCMIND_CLOUD_BETA=1",
    "",
    "NEXT_PUBLIC_APP_ENV=development",
    "DOCMIND_STORAGE=fs",
    "DOCMIND_FS_FALLBACK=0",
    "",
  ];

  for (const entry of entries) {
    if (entry.kind === "comment") continue;
    if (CLOUD_KEYS.has(entry.key)) {
      cloudLines.push(`${entry.key}=${entry.value}`);
    } else {
      localLines.push(`${entry.key}=${entry.value}`);
    }
  }

  fs.writeFileSync(CLOUD_FILE, `${cloudLines.join("\n")}\n`, "utf8");
  fs.writeFileSync(LOCAL_FILE, `${localLines.join("\n")}\n`, "utf8");
  console.log(`Écrit: ${path.basename(LOCAL_FILE)} (local isolé)`);
  console.log(`Écrit: ${path.basename(CLOUD_FILE)} (cloud bêta opt-in)`);
}

main();
