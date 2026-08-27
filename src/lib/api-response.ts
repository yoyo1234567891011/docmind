import { NextResponse } from "next/server";

import type { ApiErrorCode, ApiResponse } from "@/types";
import {
  isAppError,
  isStripeWebhookSignatureError,
  toApiErrorResponse,
} from "@/lib/errors";

export function apiSuccess<T>(data: T, status = 200) {
  const body: ApiResponse<T> = {
    success: true,
    data,
  };

  return NextResponse.json(body, { status });
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  status = 400,
) {
  return NextResponse.json(
    {
      success: false,
      error: { code, message },
    } satisfies ApiResponse<never>,
    { status },
  );
}

export function apiFromUnknownError(error: unknown) {
  const payload = toApiErrorResponse(error);
  let status = isAppError(error) ? error.status : 500;
  if (isStripeWebhookSignatureError(error)) {
    status = 400;
  }

  if (status >= 500) {
    const message =
      error instanceof Error ? error.message.slice(0, 200) : "Unknown error";
    const code = isAppError(error) ? error.code : "INTERNAL_ERROR";
    void import("@/services/monitoring/store")
      .then(({ appendMonitoringEvent }) =>
        appendMonitoringEvent({
          name: "server.error",
          meta: { status, code, message },
        }),
      )
      .catch(() => undefined);
  }

  return NextResponse.json(payload, { status });
}
