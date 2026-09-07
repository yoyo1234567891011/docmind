/**
 * Politique requeue P2 — classifie les erreurs Groq et décide requeue vs fail.
 *
 * rate_limit (429/TPM) : toujours requeue jusqu’à N tentatives (pas de fail au 1er coup).
 * Autres erreurs : requeue sélectif ou fail immédiat selon la classe.
 */
import { AppError } from "@/lib/errors";
import { isTransientLlmSaturationError } from "@/lib/sanitize";

import {
  ANALYSIS_MAX_TRANSIENT_ATTEMPTS,
  ANALYSIS_RATE_LIMIT_DEFER_MS,
  ANALYSIS_REQUEUE_MIN_REMAINING_MS,
  getAnalysisJobRemainingMs,
} from "./store";
import type { AnalysisJob } from "./types";

export type P2ErrorClass =
  | "rate_limit"
  | "timeout"
  | "model_error"
  | "parse_error"
  | "network"
  | "unknown";

/** Tentatives max avant fail définitif sous 429/TPM (objectif user : 3–5). */
export const RATE_LIMIT_MAX_ATTEMPTS = 5;

export function classifyP2Error(error: unknown): P2ErrorClass {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const status = error instanceof AppError ? error.status : 0;

  if (
    isTransientLlmSaturationError(raw) ||
    status === 429 ||
    (status === 503 && /rate_limit|satur|TPM|débit|quota ia/i.test(raw))
  ) {
    return "rate_limit";
  }
  if (/timeout|annul|abort|sous \d+\s*s/i.test(raw) || status === 504) {
    return "timeout";
  }
  if (
    /model_not_found|404|does not exist|no longer available|deprecated/i.test(
      raw,
    )
  ) {
    return "model_error";
  }
  if (
    /JSON d'analyse|INVALID_JSON|parse|tronqué|schéma d'analyse/i.test(raw)
  ) {
    return "parse_error";
  }
  if (/injoignable|réseau|network|fetch failed|ECONNRESET/i.test(raw)) {
    return "network";
  }
  return "unknown";
}

export function computeRequeueDeferMs(
  job: Pick<AnalysisJob, "createdAt">,
): number {
  const remaining = getAnalysisJobRemainingMs(job);
  return Math.min(
    ANALYSIS_RATE_LIMIT_DEFER_MS,
    Math.max(8_000, Math.min(remaining - 15_000, ANALYSIS_RATE_LIMIT_DEFER_MS)),
  );
}

/**
 * last_error stable pour DB / UI / logs — préfixe = classe.
 * Ex. `rate_limit: en file, nouvel essai automatique`
 */
export function formatP2LastError(
  errorClass: P2ErrorClass,
  kind: "requeue" | "fail",
  attempts: number,
): string {
  if (kind === "requeue") {
    switch (errorClass) {
      case "rate_limit":
        return "rate_limit: en file, nouvel essai automatique (quota IA temporaire)";
      case "timeout":
        return "timeout: en file, nouvel essai automatique";
      case "network":
        return "network: en file, nouvel essai automatique";
      default:
        return `${errorClass}: en file, nouvel essai automatique`;
    }
  }

  switch (errorClass) {
    case "rate_limit":
      return `rate_limit: échec définitif après ${attempts} tentative(s) (quota IA saturé)`;
    case "timeout":
      return `timeout: échec définitif après ${attempts} tentative(s)`;
    case "model_error":
      return "model_error: modèle d’analyse indisponible ou incorrect";
    case "parse_error":
      return "parse_error: JSON d’analyse invalide ou tronqué";
    case "network":
      return `network: échec définitif après ${attempts} tentative(s)`;
    default:
      return `unknown: échec définitif après ${attempts} tentative(s)`;
  }
}

export function shouldRequeueAfterP2Failure(
  job: AnalysisJob,
  error: unknown,
): { requeue: boolean; deferMs: number; errorClass: P2ErrorClass } {
  const errorClass = classifyP2Error(error);
  const remaining = getAnalysisJobRemainingMs(job);

  // 429/TPM : requeue jusqu’à N=5 — NE PAS échouer au 1er coup, même si budget serré.
  if (errorClass === "rate_limit") {
    if (job.attempts >= RATE_LIMIT_MAX_ATTEMPTS) {
      return { requeue: false, deferMs: 0, errorClass };
    }
    const deferMs = Math.min(
      ANALYSIS_RATE_LIMIT_DEFER_MS,
      Math.max(8_000, Math.min(remaining > 0 ? remaining - 5_000 : 8_000, 25_000)),
    );
    return { requeue: true, deferMs, errorClass };
  }

  if (job.attempts >= ANALYSIS_MAX_TRANSIENT_ATTEMPTS) {
    return { requeue: false, deferMs: 0, errorClass };
  }
  if (remaining < ANALYSIS_REQUEUE_MIN_REMAINING_MS) {
    return { requeue: false, deferMs: 0, errorClass };
  }

  const transient =
    errorClass === "network" ||
    (errorClass === "timeout" && job.attempts <= 2);

  if (!transient) {
    return { requeue: false, deferMs: 0, errorClass };
  }

  return {
    requeue: true,
    deferMs: computeRequeueDeferMs(job),
    errorClass,
  };
}
