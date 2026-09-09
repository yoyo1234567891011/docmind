/**
 * Contrat beta : résultat du bundle LLM core (fast path).
 * Séparé du chemin Ollama pour tests unitaires sans réseau.
 */
import type { OllamaGenerateResult } from "@/ai/models/types";
import {
  asStringArray,
  diagnoseJsonParseFailure,
  tryParseJsonObject,
} from "@/ai/validation/json";
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

/** Sous-raison exposée dans last_error / logs. */
export type CoreBundleParseReason =
  | "empty"
  | "json_parse"
  | "schema"
  | "truncated"
  | "strip_no_object"
  | "generate_failed";

export type CoreBundleOutcome =
  | { ok: true; parsed: CoreBundleParsed; text: string }
  | {
      ok: false;
      code: CoreBundleFailureCode;
      reason: CoreBundleParseReason;
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
  const risks = asStringArray(parsed.risks);
  const actions = asStringArray(parsed.actions);
  const documentType =
    typeof parsed.document_type === "string" &&
    parsed.document_type.trim().length > 0;
  const title =
    typeof parsed.title === "string" && parsed.title.trim().length > 0;
  return (
    summary ||
    points.length > 0 ||
    findings.length > 0 ||
    risks.length > 0 ||
    actions.length > 0 ||
    (documentType && title)
  );
}

/** Résumé local publiable — jamais de marqueur salvage. */
export function buildLocalFallbackSummary(input: {
  categoryLabel: string;
  fileName?: string;
  amounts?: string[];
  deadlines?: string[];
  risks?: string[];
  importantPoints?: string[];
}): string {
  const risks = (input.risks ?? []).filter(
    (r): r is string => typeof r === "string" && r.trim().length > 0,
  );
  const points = (input.importantPoints ?? []).filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0,
  );
  if (risks.length > 0) {
    return `Éléments repérés : ${risks.slice(0, 3).join(" ; ")}.`;
  }
  if (points.length > 0) {
    return points.slice(0, 2).join(" ");
  }
  const bits = [
    ...(input.amounts ?? []).filter((a): a is string => typeof a === "string"),
    ...(input.deadlines ?? []).filter((d): d is string => typeof d === "string"),
  ].slice(0, 2);
  if (bits.length > 0) {
    return `Document ${input.categoryLabel ?? "Document"} — ${bits.join(", ")}.`;
  }
  return `Analyse partielle du document (${input.categoryLabel ?? "Document"}).`;
}

/** Tente de récupérer un bundle partiel / tronqué avant d’échouer. */
export function salvageCoreBundleFromGeneration(input: {
  text: string;
  fallbacks: {
    categoryLabel: string;
    fileName?: string;
    amounts?: string[];
    deadlines?: string[];
  };
}): CoreBundleParsed | null {
  const parsed = tryParseJsonObject<CoreBundleParsed>(input.text);
  if (!parsed) return null;
  const enriched = enrichThinCoreBundle(parsed, input.fallbacks);
  return isCoreBundleSchemaValid(enriched) ? enriched : null;
}

/** Complète un bundle LLM trop maigre (Groq sporadique) avec des fallbacks locaux. */
export function enrichThinCoreBundle(
  parsed: CoreBundleParsed,
  fallbacks: {
    categoryLabel: string;
    fileName?: string;
    amounts?: string[];
    deadlines?: string[];
  },
): CoreBundleParsed {
  const enriched: CoreBundleParsed = { ...parsed };
  const documentType =
    typeof enriched.document_type === "string"
      ? enriched.document_type.trim()
      : "";
  const title =
    typeof enriched.title === "string" ? enriched.title.trim() : "";
  const summary =
    typeof enriched.summary === "string" ? enriched.summary.trim() : "";

  if (!documentType) {
    enriched.document_type = fallbacks.categoryLabel;
  }
  if (!title) {
    enriched.title =
      fallbacks.fileName?.replace(/\.pdf$/i, "") || fallbacks.categoryLabel;
  }
  if (!summary) {
    const risks = asStringArray(enriched.risks);
    const findings = parseRiskFindings(enriched.risk_findings);
    const points = parseImportantPointDrafts(enriched.important_points);
    enriched.summary = buildLocalFallbackSummary({
      categoryLabel: fallbacks.categoryLabel,
      fileName: fallbacks.fileName,
      amounts: fallbacks.amounts,
      deadlines: fallbacks.deadlines,
      risks:
        risks.length > 0
          ? risks
          : findings.map((f) => f.description).slice(0, 3),
      importantPoints: points.map((p) => p.statement),
    });
  }
  return enriched;
}

/**
 * Interprète la sortie generate (ou son absence).
 * Ne masque pas timeout / abort / HTTP / JSON / schéma.
 * Messages préfixés `parse_error:<reason>` pour last_error job.
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
      reason: "generate_failed",
      message,
      httpStatus: timedOut ? 504 : 502,
      appCode: "OLLAMA_UNAVAILABLE",
    };
  }

  const text = input.generation.text?.trim() ?? "";
  const truncated = input.generation.finishReason === "length";
  if (!text) {
    return {
      ok: false,
      code: "GENERATE_FAILED",
      reason: truncated ? "truncated" : "empty",
      message: truncated
        ? "parse_error:truncated — Réponse IA tronquée (limite de tokens)."
        : "parse_error:empty — Ollama a renvoyé une réponse vide.",
      httpStatus: 502,
      appCode: "OLLAMA_UNAVAILABLE",
    };
  }

  const parsed = tryParseJsonObject<CoreBundleParsed>(text);
  if (!parsed) {
    const diag = diagnoseJsonParseFailure(text);
    const reason = truncated
      ? ("truncated" as const)
      : diag === "strip_no_object"
        ? ("strip_no_object" as const)
        : ("json_parse" as const);
    return {
      ok: false,
      code: "INVALID_JSON",
      reason,
      message: `parse_error:${reason} — JSON d'analyse invalide ou tronqué${truncated ? " (limite de tokens)" : ""}.`,
      httpStatus: 502,
      appCode: "ANALYSIS_FAILED",
    };
  }

  if (!isCoreBundleSchemaValid(parsed)) {
    return {
      ok: false,
      code: "INVALID_SCHEMA",
      reason: truncated ? "truncated" : "schema",
      message: truncated
        ? "parse_error:truncated — Schéma d'analyse insuffisant (réponse tronquée)."
        : "parse_error:schema — Schéma d'analyse insuffisant (summary / points / risques absents).",
      httpStatus: 502,
      appCode: "ANALYSIS_FAILED",
    };
  }

  return { ok: true, parsed, text };
}

/** Bundle minimal à partir des faits locaux P1 — évite fail total si LLM a tourné. */
export function buildDeterministicPartialCoreBundle(fallbacks: {
  categoryLabel: string;
  fileName?: string;
  amounts?: string[];
  deadlines?: string[];
}): CoreBundleParsed {
  const amounts = (fallbacks.amounts ?? []).filter(
    (a): a is string => typeof a === "string" && a.trim().length > 0,
  );
  const deadlines = (fallbacks.deadlines ?? []).filter(
    (d): d is string => typeof d === "string" && d.trim().length > 0,
  );
  const summary = buildLocalFallbackSummary({
    categoryLabel: fallbacks.categoryLabel,
    fileName: fallbacks.fileName,
    amounts,
    deadlines,
  });
  return {
    document_type: fallbacks.categoryLabel,
    title:
      fallbacks.fileName?.replace(/\.pdf$/i, "") || fallbacks.categoryLabel,
    summary,
    important_points: amounts.slice(0, 4).map((a) => ({
      statement: a,
      excerpt: a,
    })),
    risk_findings: [],
    risks: amounts.slice(0, 3),
    actions: [
      ...deadlines.slice(0, 2).map((d) => `Vérifier l’échéance : ${d}`),
      ...(amounts[0] ? [`Contrôler le montant : ${amounts[0]}`] : []),
    ].slice(0, 4),
  };
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

const SALVAGE_SUMMARY_MARKERS = [
  "Analyse de secours",
  "Analyse partielle : le modèle n'a pas renvoyé",
  "Analyse multi-agents incomplète",
] as const;

/** Préfixes worker / legacy — retirés avant publication si une passe LLM a tourné. */
const WORKER_SALVAGE_PREFIXES = [
  /^Analyse de secours\s*\(fallback local\)\s*\.?\s*/i,
  /^Analyse de secours\s*\(extraction locale\)\s*\.?\s*/i,
  /^Analyse de secours\s*\.?\s*/i,
] as const;

export function stripWorkerSalvageSummaryPrefix(
  summary: string | undefined,
): string {
  const s = summary?.trim() ?? "";
  for (const re of WORKER_SALVAGE_PREFIXES) {
    const next = s.replace(re, "").trim();
    if (next !== s) {
      return next;
    }
  }
  return s;
}

export function isSalvageAnalysisSummary(summary: string | undefined): boolean {
  const s = summary?.trim() ?? "";
  if (!s) return false;
  return SALVAGE_SUMMARY_MARKERS.some(
    (m) => s.startsWith(m) || s.includes(m),
  );
}

function llmGenerationRecorded(input: {
  totalTokens?: number;
  generateMs?: number;
}): boolean {
  return (input.totalTokens ?? 0) >= 1 || (input.generateMs ?? 0) >= 50;
}

/**
 * Bloque la publication d’un résultat sans vraie passe LLM
 * (fallback local masqué en succès).
 */
export function assertPublishableLlmAnalysis(input: {
  resultSource?: "agents" | "salvage" | "cache";
  totalTokens?: number;
  generateMs?: number;
  summary?: string;
}): void {
  if (!isLlmAnalysisSuccess(input.resultSource)) {
    throw new AppError(
      "ANALYSIS_FAILED",
      "Analyse LLM indisponible — fallback local non publié.",
      502,
    );
  }
  const summaryForCheck = stripWorkerSalvageSummaryPrefix(input.summary);
  if (isSalvageAnalysisSummary(summaryForCheck)) {
    // Groq a tourné (ou cache validé) : enrichissement local ≠ échec LLM total.
    if (llmGenerationRecorded(input) || input.resultSource === "cache") {
      return;
    }
    const workerTagged = input.summary?.trim().startsWith("Analyse de secours");
    throw new AppError(
      "ANALYSIS_FAILED",
      workerTagged
        ? "Analyse LLM indisponible — fallback local (relancez l’analyse)."
        : "Analyse LLM indisponible — extraction locale seule (relancez l’analyse).",
      502,
    );
  }
  if (input.resultSource === "cache") {
    return;
  }
  const tokens = input.totalTokens ?? 0;
  const generateMs = input.generateMs ?? 0;
  if (tokens < 1 && generateMs < 50) {
    throw new AppError(
      "ANALYSIS_FAILED",
      "Aucune génération LLM enregistrée pour cette analyse.",
      502,
    );
  }
}
