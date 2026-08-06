import { sanitizeDeadlines } from "@/ai/extraction";
import {
  asString,
  asStringArray,
  tryParseJsonObject,
} from "@/ai/validation/json";
import {
  isRiskCriterionId,
  isRiskSeverity,
  normalizeRiskExplanations,
  type DocumentAnalysis,
  type RiskFinding,
} from "@/types";

type ParsedAnalysis = Omit<
  DocumentAnalysis,
  "risk_score" | "risk_level" | "risk_explanation" | "risk_criteria"
>;

function asConfidence(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  if (typeof value === "string") {
    const n = Number(value.replace(",", "."));
    if (Number.isFinite(n)) return Math.min(1, Math.max(0, n));
  }
  return 0.5;
}

function parseRiskFindings(raw: unknown): RiskFinding[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const findings: RiskFinding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const description =
      typeof o.description === "string" ? o.description.trim() : "";
    if (!description) continue;
    const criterionRaw =
      typeof o.criterion_id === "string"
        ? o.criterion_id.trim()
        : typeof o.criterionId === "string"
          ? o.criterionId.trim()
          : "";
    const severityRaw =
      typeof o.severity === "string" ? o.severity.trim() : "modere";
    const explanations = normalizeRiskExplanations(o);
    findings.push({
      description,
      ...explanations,
      excerpt: typeof o.excerpt === "string" ? o.excerpt.trim() : "",
      confidence: asConfidence(o.confidence),
      severity: isRiskSeverity(severityRaw) ? severityRaw : "modere",
      criterion_id: isRiskCriterionId(criterionRaw) ? criterionRaw : undefined,
      status:
        o.status === "confirmed" ||
        o.status === "ambiguous" ||
        o.status === "rejected"
          ? o.status
          : "ambiguous",
      related_to:
        typeof o.related_to === "string"
          ? o.related_to.trim()
          : typeof o.relatedTo === "string"
            ? o.relatedTo.trim()
            : undefined,
    });
  }
  return findings;
}

function normalizeParsed(
  parsed: Record<string, unknown> | null,
): ParsedAnalysis | null {
  if (!parsed || typeof parsed !== "object") return null;

  const risk_findings = parseRiskFindings(parsed.risk_findings);

  return {
    document_type: asString(parsed.document_type),
    title: asString(parsed.title),
    summary: asString(parsed.summary),
    date: asString(parsed.date),
    dates: asStringArray(parsed.dates),
    people: asStringArray(parsed.people),
    organizations: asStringArray(parsed.organizations),
    amounts: asStringArray(parsed.amounts),
    deadlines: sanitizeDeadlines(asStringArray(parsed.deadlines)),
    important_points: asStringArray(parsed.important_points),
    risks: asStringArray(parsed.risks),
    actions: asStringArray(parsed.actions),
    ...(risk_findings !== undefined ? { risk_findings } : {}),
    // Conservés temporairement pour verify (strippés ensuite)
    ...(typeof parsed._reasoning === "string"
      ? { _reasoning: parsed._reasoning }
      : {}),
    ...(parsed._self_check !== undefined
      ? { _self_check: parsed._self_check }
      : {}),
  } as ParsedAnalysis & {
    _reasoning?: string;
    _self_check?: unknown;
  };
}

/**
 * Validates / normalizes the analysis LLM payload.
 * Returns null if the model reply cannot be interpreted (caller may retry/salvage).
 * Clés inconnues ignorées ; risk_findings optionnel.
 */
export function parseDocumentAnalysisResponse(
  raw: string,
): ParsedAnalysis | null {
  const parsed = tryParseJsonObject<Record<string, unknown>>(raw);
  const normalized = normalizeParsed(parsed);
  if (!normalized) return null;

  const hasSignal =
    Boolean(normalized.title || normalized.summary || normalized.document_type) ||
    normalized.amounts.length > 0 ||
    normalized.deadlines.length > 0 ||
    normalized.risks.length > 0 ||
    normalized.actions.length > 0 ||
    (normalized.risk_findings?.length ?? 0) > 0;

  return hasSignal ? normalized : null;
}
