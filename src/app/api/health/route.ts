import { NextResponse } from "next/server";

import { checkLlmHealth } from "@/ai/models/llm-health";
import {
  getAppVersion,
  getDeployEnv,
  getMaintenanceMessage,
  isMaintenanceMode,
} from "@/config/runtime";
import { validateProductionEnv } from "@/lib/env-validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Healthcheck public (pas d'auth) — pour monitoring / load balancer.
 * Sonde LLM = fournisseur réel (Ollama local ou cloud openai_compatible).
 * Détails sensibles limités ; `?details=1` réservé au monitoring interne.
 */
export async function GET(request: Request) {
  const maintenance = isMaintenanceMode();
  const details =
    new URL(request.url).searchParams.get("details") === "1" &&
    process.env.HEALTH_DETAILS_TOKEN &&
    request.headers.get("x-health-token") ===
      process.env.HEALTH_DETAILS_TOKEN;

  const { ok: llmOk, backend: llmBackend } = await checkLlmHealth();

  const status = maintenance ? "maintenance" : llmOk ? "ok" : "degraded";
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
    body.checks = {
      llm: llmOk ? "up" : "down",
      llmBackend,
      ollama: llmBackend === "ollama" ? (llmOk ? "up" : "down") : "skipped",
    };
    body.envIssues = envIssues;
  } else {
    body.ok = status === "ok";
  }

  return NextResponse.json(body, {
    status: httpStatus,
    headers: { "Cache-Control": "no-store" },
  });
}
