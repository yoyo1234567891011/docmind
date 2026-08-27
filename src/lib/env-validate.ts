/**
 * Validation des variables d’environnement critiques (production / beta).
 */

export type EnvIssue = { level: "error" | "warn"; message: string };

function appEnv(): string {
  return (
    process.env.NEXT_PUBLIC_APP_ENV ||
    process.env.NODE_ENV ||
    "development"
  ).toLowerCase();
}

export function isDeployedEnv(): boolean {
  const env = appEnv();
  return env === "production" || env === "beta" || env === "staging";
}

export function validateProductionEnv(): EnvIssue[] {
  const issues: EnvIssue[] = [];
  if (!isDeployedEnv()) return issues;

  const require = (key: string, label?: string) => {
    if (!process.env[key]?.trim()) {
      issues.push({
        level: "error",
        message: `${label || key} manquant — requis en ${appEnv()}.`,
      });
    }
  };

  require("NEXT_PUBLIC_SUPABASE_URL");
  require("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  require(
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY (suppression de compte RGPD)",
  );
  require("NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_APP_URL (Checkout / redirects)");
  require("ADMIN_EMAILS");
  require("STRIPE_SECRET_KEY");
  require("STRIPE_PRICE_BASIQUE");
  require("STRIPE_PRICE_PRO");
  require("STRIPE_PRICE_PREMIUM");
  require("STRIPE_PRICE_EXTRA");
  require("STRIPE_WEBHOOK_SECRET");
  require("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
  require("DATABASE_URL", "DATABASE_URL (Postgres — données critiques)");
  require("REDIS_URL", "REDIS_URL (rate-limit distribué)");
  require("S3_BUCKET", "S3_BUCKET (PDF Object Storage)");
  require("S3_ACCESS_KEY_ID");
  require("S3_SECRET_ACCESS_KEY");
  if (
    !process.env.S3_ENDPOINT?.trim() &&
    !process.env.AWS_REGION?.trim() &&
    !process.env.S3_REGION?.trim()
  ) {
    issues.push({
      level: "error",
      message: "S3_ENDPOINT ou AWS_REGION/S3_REGION manquant.",
    });
  }

  if (process.env.BILLING_ENTITLEMENTS_FAIL_OPEN === "1") {
    issues.push({
      level: "error",
      message:
        "BILLING_ENTITLEMENTS_FAIL_OPEN=1 interdit en environnement déployé.",
    });
  }

  // TLS Postgres : assouplissement self-signed interdit en production stricte.
  // Autorisé en staging/beta/local pour Supabase (PG_SSL_REJECT_UNAUTHORIZED=0).
  if (
    appEnv() === "production" &&
    process.env.PG_SSL_REJECT_UNAUTHORIZED?.trim() === "0"
  ) {
    issues.push({
      level: "error",
      message:
        "PG_SSL_REJECT_UNAUTHORIZED=0 interdit en production (TLS Postgres doit vérifier le certificat).",
    });
  }

  const storage = process.env.DOCMIND_STORAGE?.trim().toLowerCase();
  if (storage !== "persistent") {
    issues.push({
      level: "error",
      message:
        "DOCMIND_STORAGE=persistent obligatoire en environnement déployé (fs / auto interdit).",
    });
  }

  const fallback = process.env.DOCMIND_FS_FALLBACK?.trim().toLowerCase();
  if (fallback !== "0" && fallback !== "false" && fallback !== "off") {
    issues.push({
      level: "error",
      message:
        "DOCMIND_FS_FALLBACK=0 obligatoire en environnement déployé (promotion FS→PG interdite).",
    });
  }

  if (process.env.EVAL_API_KEY?.trim()) {
    if (process.env.EVAL_ALLOW_IN_DEPLOY === "1") {
      issues.push({
        level: "warn",
        message:
          "EVAL_ALLOW_IN_DEPLOY=1 — bypass auth EVAL actif en déployé (restreindre réseau / clé forte).",
      });
    } else {
      issues.push({
        level: "warn",
        message:
          "EVAL_API_KEY défini mais ignoré en déployé (définir EVAL_ALLOW_IN_DEPLOY=1 pour l’activer).",
      });
    }
  }

  if (!process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL?.trim()) {
    issues.push({
      level: "warn",
      message:
        "NEXT_PUBLIC_LEGAL_CONTACT_EMAIL manquant — pages légales incomplètes.",
    });
  }

  return issues;
}

/**
 * En environnement déployé (production/beta/staging), les protections
 * critiques ne peuvent PAS être contournées par DOCMIND_SKIP_ENV_ASSERT.
 * SKIP n’est autorisé qu’en development (CI locale / scripts).
 */
export function assertProductionEnvOrThrow(): void {
  const skipRequested = process.env.DOCMIND_SKIP_ENV_ASSERT === "1";
  if (skipRequested && !isDeployedEnv()) return;

  const issues = validateProductionEnv().filter((i) => i.level === "error");
  if (issues.length > 0) {
    const message = issues.map((i) => i.message).join("\n");
    throw new Error(`[docmind:env] Configuration invalide:\n${message}`);
  }
}
