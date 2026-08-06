/**
 * Configuration runtime (bêta / production).
 * Valeurs surchargées par variables d'environnement — voir .env.example
 */

export type AppDeployEnv = "development" | "beta" | "production";

function readBool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === "") return fallback;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function resolveDeployEnv(): AppDeployEnv {
  const raw = (process.env.NEXT_PUBLIC_APP_ENV || process.env.APP_ENV || "")
    .trim()
    .toLowerCase();
  if (raw === "beta" || raw === "production" || raw === "development") {
    return raw;
  }
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

export function getAppVersion(): string {
  return (
    process.env.NEXT_PUBLIC_APP_VERSION?.trim() ||
    process.env.npm_package_version ||
    "0.1.0-beta"
  );
}

export function getDeployEnv(): AppDeployEnv {
  return resolveDeployEnv();
}

export function isMaintenanceMode(): boolean {
  return readBool(process.env.MAINTENANCE_MODE, false);
}

export function getMaintenanceMessage(): string {
  return (
    process.env.MAINTENANCE_MESSAGE?.trim() ||
    "DocMind est en maintenance. Merci de réessayer dans quelques minutes."
  );
}

export function getMaintenanceBypassSecret(): string | null {
  const secret = process.env.MAINTENANCE_BYPASS_SECRET?.trim();
  return secret || null;
}

export function isBetaFeedbackEnabled(): boolean {
  return readBool(process.env.BETA_FEEDBACK_ENABLED, true);
}

export function getPublicRuntimeInfo() {
  return {
    env: getDeployEnv(),
    version: getAppVersion(),
    maintenance: isMaintenanceMode(),
    feedbackEnabled: isBetaFeedbackEnabled(),
  };
}
