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

/** Mapping codes techniques → messages FR actionnables (UI bêta). */
export function friendlyErrorMessage(
  code: string | null | undefined,
  fallback?: string | null,
): string {
  switch (code) {
    case "OLLAMA_UNAVAILABLE":
      return "L'analyse locale est indisponible. Vérifiez qu'Ollama est démarré, puis réessayez.";
    case "UNSUPPORTED_FILE":
      return "Ce fichier n'est pas un PDF valide.";
    case "EXTRACTION_FAILED":
      return "Impossible de lire le texte de ce PDF.";
    case "ANALYSIS_FAILED":
      return "L'analyse n'a pas pu aboutir. Réessayez ou signalez le problème.";
    case "UNAUTHORIZED":
      return "Connexion requise.";
    case "FORBIDDEN":
      return "Accès non autorisé.";
    case "SERVICE_UNAVAILABLE":
      return "Service temporairement indisponible (maintenance).";
    case "BAD_REQUEST":
      return fallback?.trim()
        ? sanitizeUserText(fallback, 240)
        : "Requête invalide.";
    default:
      return fallback?.trim()
        ? sanitizeUserText(fallback, 240)
        : "Une erreur est survenue. Réessayez ou envoyez un signalement.";
  }
}
