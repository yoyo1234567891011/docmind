/**
 * Nettoyage des messages destinés aux logs / signalements (bêta).
 * Retire secrets, emails, chemins locaux et payloads trop longs.
 */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const JWT_RE = /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g;
const KEY_RE =
  /(?:api[_-]?key|secret|token|password|authorization)\s*[:=]\s*["']?[^\s"',}{]+/gi;
const PATH_RE =
  /(?:[A-Za-z]:\\|\/(?:Users|home|var|tmp|opt)\/)[^\s"'<>]+/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._\-]+/gi;

export function sanitizeUserText(
  input: string,
  maxLength = 2_000,
): string {
  let text = input.replace(/\r\n/g, "\n").trim();
  text = text
    .replace(JWT_RE, "[jwt]")
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(KEY_RE, "[secret]")
    .replace(EMAIL_RE, "[email]")
    .replace(PATH_RE, "[path]");

  if (text.length > maxLength) {
    text = `${text.slice(0, maxLength)}…`;
  }
  return text;
}

export function sanitizeErrorMessage(input: unknown): string {
  if (input instanceof Error) {
    return sanitizeUserText(input.message, 500);
  }
  if (typeof input === "string") {
    return sanitizeUserText(input, 500);
  }
  return "Erreur inconnue";
}

/** Erreurs LLM / jobs : pas de JSON Groq brut dans l’UI. */
export function sanitizeAnalysisFailureMessage(input: unknown): string {
  const raw =
    input instanceof Error
      ? input.message
      : typeof input === "string"
        ? input
        : "";
  if (isTransientLlmSaturationError(raw)) {
    return LLM_SATURATION_USER_MESSAGE;
  }
  if (raw.trim().startsWith("{") && /"error"|rate_limit/i.test(raw)) {
    return ANALYSIS_SATURATION_OR_TIMEOUT_MESSAGE;
  }
  if (raw.trim()) return sanitizeUserText(raw, 280);
  return "L’analyse approfondie a échoué. Réessayez — le document uploadé est conservé.";
}

/** Message UI unique — saturation TPM, timeout job ou indisponibilité LLM temporaire. */
export const ANALYSIS_SATURATION_OR_TIMEOUT_MESSAGE =
  "Service d’analyse saturé. Réessayez dans 1 à 2 minutes — l’aperçu reste disponible.";

export const LLM_SATURATION_USER_MESSAGE = ANALYSIS_SATURATION_OR_TIMEOUT_MESSAGE;

/** Message quand le job est remis en file (pas un échec définitif). */
export const LLM_SATURATION_REQUEUE_MESSAGE =
  "Analyse en file d’attente : le service est saturé. Nouvelle tentative automatique sous peu.";

/** Échec définitif après saturation / retries épuisés. */
export const LLM_SATURATION_FAIL_MESSAGE = ANALYSIS_SATURATION_OR_TIMEOUT_MESSAGE;

/** Échec définitif — budget temps global job épuisé. */
export const ANALYSIS_JOB_GLOBAL_TIMEOUT_MESSAGE =
  ANALYSIS_SATURATION_OR_TIMEOUT_MESSAGE;

/**
 * 429 / TPM / verrou génération — à requeue plutôt qu’à échouer.
 */
export function isTransientLlmSaturationError(input: unknown): boolean {
  const raw =
    input instanceof Error
      ? input.message
      : typeof input === "string"
        ? input
        : "";
  return /rate_limit|tokens per minute|\bTPM\b|limite de débit|saturé|file d['’]attente GPU|verrou GPU/i.test(
    raw,
  );
}

/** Mapping codes techniques → messages FR actionnables (UI bêta). */
export function friendlyErrorMessage(
  code: string | null | undefined,
  fallback?: string | null,
): string {
  const fallbackSafe = fallback?.trim()
    ? sanitizeAnalysisFailureMessage(fallback)
    : null;
  switch (code) {
    case "OLLAMA_UNAVAILABLE":
      if (
        fallback &&
        /rate_limit|TPM|saturé|limite de débit|temporairement/i.test(fallback)
      ) {
        return fallbackSafe ?? sanitizeAnalysisFailureMessage(fallback);
      }
      return isCloudHint(fallback)
        ? fallbackSafe ||
            "Le service d’analyse est temporairement indisponible. Réessayez dans un instant."
        : "L'analyse locale est indisponible. Vérifiez qu'Ollama est démarré, puis réessayez.";
    case "UNSUPPORTED_FILE":
      return "Ce fichier n'est pas un PDF valide.";
    case "EXTRACTION_FAILED":
      return "Impossible de lire le texte de ce PDF.";
    case "ANALYSIS_FAILED":
      return (
        fallbackSafe ||
        "L'analyse n'a pas pu aboutir. Réessayez ou signalez le problème."
      );
    case "UNAUTHORIZED":
      return "Connexion requise.";
    case "FORBIDDEN":
      return "Accès non autorisé.";
    case "SERVICE_UNAVAILABLE":
      return "Service temporairement indisponible (maintenance).";
    case "BAD_REQUEST":
      return fallbackSafe || "Requête invalide.";
    default:
      return (
        fallbackSafe ||
        "Une erreur est survenue. Réessayez ou envoyez un signalement."
      );
  }
}

function isCloudHint(fallback?: string | null): boolean {
  if (!fallback) return false;
  return /API LLM|Groq|openai|saturé|débit|temporairement/i.test(fallback);
}
