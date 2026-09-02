/**
 * Politique requeue P2 — classifie les erreurs Groq et décide requeue vs fail.
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
  | "rate_limit_429"
  | "timeout"
  | "model_error"
  | "parse_error"
  | "network"
  | "unknown";

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
    (status === 503 && /rate_limit|satur|TPM|débit/i.test(raw))
  ) {
    return "rate_limit_429";
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
    Math.max(8_000, remaining - 50_000),
  );
}

export function shouldRequeueAfterP2Failure(
  job: AnalysisJob,
  error: unknown,
): { requeue: boolean; deferMs: number; errorClass: P2ErrorClass } {
  const errorClass = classifyP2Error(error);
  const remaining = getAnalysisJobRemainingMs(job);

  if (job.attempts >= ANALYSIS_MAX_TRANSIENT_ATTEMPTS) {
    return { requeue: false, deferMs: 0, errorClass };
  }
  if (remaining < ANALYSIS_REQUEUE_MIN_REMAINING_MS) {
    return { requeue: false, deferMs: 0, errorClass };
  }

  const transient =
    errorClass === "rate_limit_429" ||
    (errorClass === "network" && job.attempts < ANALYSIS_MAX_TRANSIENT_ATTEMPTS) ||
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
