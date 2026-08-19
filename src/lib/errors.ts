import type { ApiErrorCode, ApiErrorResponse } from "@/types";

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, status = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

/** Signature Stripe invalide → 400 (pas retry automatique). */
export function isStripeWebhookSignatureError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  const type = (error as { type?: string }).type;
  return (
    name === "StripeSignatureVerificationError" ||
    type === "StripeSignatureVerificationError"
  );
}

export function toApiErrorResponse(error: unknown): ApiErrorResponse {
  if (error instanceof AppError) {
    return {
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    };
  }

  if (isStripeWebhookSignatureError(error)) {
    return {
      success: false,
      error: {
        code: "BAD_REQUEST",
        message: "Signature webhook Stripe invalide.",
      },
    };
  }

  return {
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Une erreur inattendue s’est produite. Réessayez dans un instant.",
    },
  };
}
