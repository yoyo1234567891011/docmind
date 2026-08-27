/**
 * Audit variables Vercel production (présence + placeholders, sans afficher les secrets).
 * Usage: npx tsx scripts/audit-vercel-env.ts [.env.vercel.production]
 */
import { existsSync, readFileSync, unlinkSync } from "fs";

const file = process.argv[2] ?? ".env.vercel.check.tmp";
if (!existsSync(file)) {
  console.error(`Fichier absent: ${file}`);
  process.exit(1);
}

function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value
        .slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"');
    }
    env[key] = value;
  }
  return env;
}

const env = parseEnvFile(readFileSync(file, "utf8"));

const critical = [
  "DATABASE_URL",
  "REDIS_URL",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_BASIQUE",
  "STRIPE_PRICE_PRO",
  "STRIPE_PRICE_PREMIUM",
  "STRIPE_PRICE_EXTRA",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_APP_URL",
  "ADMIN_EMAILS",
  "DOCMIND_STORAGE",
  "DOCMIND_FS_FALLBACK",
  "CRON_SECRET",
  "GROQ_API_KEY",
  "LLM_MODEL",
  "NEXT_PUBLIC_APP_ENV",
] as const;

const legal = [
  "NEXT_PUBLIC_LEGAL_ENTITY_NAME",
  "NEXT_PUBLIC_LEGAL_ADDRESS",
  "NEXT_PUBLIC_LEGAL_CONTACT_EMAIL",
] as const;

const placeholders = [
  /éditeur à compléter/i,
  /adresse.*compléter/i,
  /exemple/i,
  /your-/i,
  /à compléter/i,
  /placeholder/i,
];

function status(key: string) {
  const v = env[key]?.trim();
  if (v === undefined) return { key, state: "ABSENT" as const };
  if (!v) return { key, state: "VIDE" as const };
  return { key, state: "SET" as const, len: v.length };
}

const report: {
  critical: ReturnType<typeof status>[];
  legal: Array<{ key: string; state: string; len?: number }>;
  warnings: string[];
  ok: string[];
  appEnv: string;
} = {
  critical: critical.map(status),
  legal: [],
  warnings: [],
  ok: [],
  appEnv: (env.NEXT_PUBLIC_APP_ENV ?? "").toLowerCase() || "ABSENT",
};

for (const key of legal) {
  const v = env[key]?.trim() ?? "";
  if (!v) report.legal.push({ key, state: "ABSENT" });
  else if (placeholders.some((p) => p.test(v)))
    report.legal.push({ key, state: "PLACEHOLDER" });
  else report.legal.push({ key, state: "OK", len: v.length });
}

const cron = env.CRON_SECRET?.trim() ?? "";
if (!cron) report.warnings.push("CRON_SECRET absent");
else if (cron.length < 16) report.warnings.push("CRON_SECRET trop court (<16 car.)");
else report.ok.push("CRON_SECRET longueur OK");

if ((env.DOCMIND_STORAGE ?? "").toLowerCase() !== "persistent")
  report.warnings.push("DOCMIND_STORAGE != persistent");
else report.ok.push("DOCMIND_STORAGE=persistent");

const fb = (env.DOCMIND_FS_FALLBACK ?? "").toLowerCase();
if (fb === "1" || fb === "true" || fb === "on")
  report.warnings.push("DOCMIND_FS_FALLBACK actif (doit être 0)");
else report.ok.push("DOCMIND_FS_FALLBACK OK");

if (
  !env.GROQ_API_KEY?.trim() &&
  !env.LLM_API_KEY?.trim() &&
  !env.MISTRAL_API_KEY?.trim()
)
  report.warnings.push("Aucune clé LLM cloud");
else report.ok.push("LLM cloud configuré");

if (
  !env.S3_ENDPOINT?.trim() &&
  !env.S3_REGION?.trim() &&
  !env.AWS_REGION?.trim()
)
  report.warnings.push("S3 endpoint/region manquant");
else report.ok.push("S3 endpoint/region OK");

if (
  report.appEnv === "production" &&
  env.PG_SSL_REJECT_UNAUTHORIZED?.trim() === "0"
)
  report.warnings.push("PG_SSL_REJECT_UNAUTHORIZED=0 en production");

if (env.STRIPE_PRICE_BASIQUE?.startsWith("price_"))
  report.ok.push("STRIPE_PRICE_BASIQUE format OK");
else report.warnings.push("STRIPE_PRICE_BASIQUE format suspect");
if (env.STRIPE_PRICE_PRO?.startsWith("price_"))
  report.ok.push("STRIPE_PRICE_PRO format OK");
else report.warnings.push("STRIPE_PRICE_PRO format suspect");
if (env.STRIPE_PRICE_PREMIUM?.startsWith("price_"))
  report.ok.push("STRIPE_PRICE_PREMIUM format OK");
else report.warnings.push("STRIPE_PRICE_PREMIUM format suspect");
if (env.STRIPE_PRICE_EXTRA?.startsWith("price_"))
  report.ok.push("STRIPE_PRICE_EXTRA format OK");
else report.warnings.push("STRIPE_PRICE_EXTRA format suspect");

if (env.NEXT_PUBLIC_APP_URL?.startsWith("http"))
  report.ok.push("NEXT_PUBLIC_APP_URL format OK");
else report.warnings.push("NEXT_PUBLIC_APP_URL manquant ou invalide");

console.log(JSON.stringify(report, null, 2));

if (file === ".env.vercel.check.tmp") {
  try {
    unlinkSync(file);
  } catch {
    /* ignore */
  }
}
