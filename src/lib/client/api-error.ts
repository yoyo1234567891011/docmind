import type { ApiErrorCode } from "@/types";

/** Erreur API typée côté client (code + message). */
export class ClientApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ClientApiError";
    this.code = code;
  }
}

export function isQuotaExceededError(
  error: unknown,
): error is ClientApiError {
  return error instanceof ClientApiError && error.code === "QUOTA_EXCEEDED";
}
