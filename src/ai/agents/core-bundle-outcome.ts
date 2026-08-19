/**
 * Contrat beta : résultat du bundle LLM core (fast path).
 * Séparé du chemin Ollama pour tests unitaires sans réseau.
 */
import type { OllamaGenerateResult } from "@/ai/models/types";
import { tryParseJsonObject } from "@/ai/validation/json";
import { AppError } from "@/lib/errors";
import {
  parseImportantPointDrafts,
  parseRiskFindings,
} from "./parse-specialists";

export type CoreBundleParsed = {
  document_type?: unknown;
  title?: unknown;
  summary?: unknown;
  important_points?: unknown;
  risk_findings?: unknown;
  risks?: unknown;
  actions?: unknown;
};

export type CoreBundleFailureCode =
  | "GENERATE_FAILED"
  | "INVALID_JSON"
  | "INVALID_SCHEMA";

export type CoreBundleOutcome =
  | { ok: true; parsed: CoreBundleParsed; text: string }
  | {
      ok: false;
      code: CoreBundleFailureCode;
      message: string;
      httpStatus: number;
      appCode: "OLLAMA_UNAVAILABLE" | "ANALYSIS_FAILED";
    };

/** Schéma minimal exploitable (Local First) : signal qualitatif présent. */
export function isCoreBundleSchemaValid(parsed: CoreBundleParsed): boolean {
  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim().length > 0;
  const points = parseImportantPointDrafts(parsed.important_points);
  const findings = parseRiskFindings(parsed.risk_findings);
  const documentType =
    typeof parsed.document_type === "string" &&
    parsed.document_type.trim().length > 0;
  const title =
    typeof parsed.title === "string" && parsed.title.trim().length > 0;
  return (
    summary ||
    points.length > 0 ||
    findings.length > 0 ||
    (documentType && title)
  );
}

/**
 * Interprète la sortie generate (ou son absence).
 * Ne masque pas timeout / abort / HTTP / JSON / schéma.
 */
export function evaluateCoreBundleGeneration(input: {
  generation: OllamaGenerateResult | null;
  error?: string;
}): CoreBundleOutcome {
  if (!input.generation) {
    const message =
      input.error?.trim() ||
      "Échec génération Ollama (timeout, abort ou erreur HTTP).";
    const timedOut = /sous \d+\s*s|timeout|annul|abort/i.test(message);
    return {
      ok: false,
      code: "GENERATE_FAILED",
      message,
      httpStatus: timedOut ? 504 : 502,
      appCode: "OLLAMA_UNAVAILABLE",
    };
  }

  const text = input.generation.text?.trim() ?? "";
  if (!text) {
    return {
      ok: false,
      code: "GENERATE_FAILED",
      message: "Ollama a renvoyé une réponse vide.",
      httpStatus: 502,
      appCode: "OLLAMA_UNAVAILABLE",
    };
  }

  const parsed = tryParseJsonObject<CoreBundleParsed>(text);
  if (!parsed) {
    return {
      ok: false,
      code: "INVALID_JSON",
      message: "JSON d'analyse invalide ou tronqué.",
      httpStatus: 502,
      appCode: "ANALYSIS_FAILED",
    };
  }

  if (!isCoreBundleSchemaValid(parsed)) {
    return {
      ok: false,
      code: "INVALID_SCHEMA",
      message:
        "Schéma d'analyse insuffisant (summary / points / risques absents).",
      httpStatus: 502,
      appCode: "ANALYSIS_FAILED",
    };
  }

  return { ok: true, parsed, text };
}

export function throwOnFailedCoreBundle(
  outcome: CoreBundleOutcome,
): asserts outcome is Extract<CoreBundleOutcome, { ok: true }> {
  if (outcome.ok) return;
  throw new AppError(outcome.appCode, outcome.message, outcome.httpStatus);
}

/** Un résultat salvage n'est jamais un succès LLM publiable. */
export function isLlmAnalysisSuccess(
  resultSource: "agents" | "salvage" | "cache" | undefined,
): boolean {
  return resultSource === "agents" || resultSource === "cache";
}
