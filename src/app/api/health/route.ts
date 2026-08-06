import { NextResponse } from "next/server";

import {
  getAppVersion,
  getDeployEnv,
  getMaintenanceMessage,
  isMaintenanceMode,
} from "@/config/runtime";
import { getOllamaBaseUrl } from "@/ai/models/config";
import {
  assertSafeOllamaBaseUrl,
  fetchOllama,
} from "@/ai/models/ollama-http";
import { validateProductionEnv } from "@/lib/env-validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Healthcheck public (pas d'auth) — pour monitoring / load balancer.
 * Détails sensibles limités ; `?details=1` réservé au monitoring interne.
 */
export async function GET(request: Request) {
  const maintenance = isMaintenanceMode();
  let ollamaOk = false;
  const details =
    new URL(request.url).searchParams.get("details") === "1" &&
    process.env.HEALTH_DETAILS_TOKEN &&
    request.headers.get("x-health-token") ===
      process.env.HEALTH_DETAILS_TOKEN;

  try {
    // Même allowlist SSRF que le reste du runtime Ollama.
    assertSafeOllamaBaseUrl(getOllamaBaseUrl());
    const response = await fetchOllama(getOllamaBaseUrl(), "/api/tags", {
      method: "GET",
      signal: AbortSignal.timeout(2_500),
    });
    ollamaOk = response.ok;
  } catch {
    ollamaOk = false;
  }

  const status = maintenance ? "maintenance" : ollamaOk ? "ok" : "degraded";
  const httpStatus = maintenance ? 503 : 200;

  const body: Record<string, unknown> = {
    status,
    maintenance,
    at: new Date().toISOString(),
  };

  if (details) {
    const envIssues = validateProductionEnv();
    body.version = getAppVersion();
    body.env = getDeployEnv();
    body.maintenanceMessage = maintenance ? getMaintenanceMessage() : null;
    body.checks = { ollama: ollamaOk ? "up" : "down" };
    body.envIssues = envIssues;
  } else {
    body.ok = status === "ok";
  }

  return NextResponse.json(body, {
    status: httpStatus,
    headers: { "Cache-Control": "no-store" },
  });
}
