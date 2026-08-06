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

  return {
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Une erreur inattendue s’est produite. Réessayez dans un instant.",
    },
  };
}
