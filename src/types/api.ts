export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "QUOTA_EXCEEDED"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "UNSUPPORTED_FILE"
  | "UPLOAD_FAILED"
  | "EXTRACTION_FAILED"
  | "OLLAMA_UNAVAILABLE"
  | "ANALYSIS_FAILED"
  | "ANALYSIS_IN_PROGRESS"
  | "INTERNAL_ERROR"
  | "NOT_IMPLEMENTED"
  | "SERVICE_UNAVAILABLE";

export interface ApiErrorResponse {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
