import { extractDocumentEntities, sanitizeDeadlines } from "@/ai/extraction";
import { mergeUniqueStrings } from "@/lib/array";
import { asString, asStringArray } from "@/ai/validation/json";
import {
  isRiskCriterionId,
  isRiskSeverity,
  normalizeRiskExplanations,
  type RiskFinding,
} from "@/types";
import type { ImportantPointDraft } from "@/ai/reasoning/verify-analysis";
import type { ExtractedFacts, LegalAnalysis } from "./types";
import { sliceList } from "./utils";

export function localFacts(documentText: string): ExtractedFacts {
  const entities = extractDocumentEntities(documentText);
  return {
    date: entities.primaryDate,
    dates: entities.dates.slice(0, 8),
    people: entities.people.slice(0, 8),
    organizations: entities.organizations.slice(0, 8),
    amounts: entities.amounts.slice(0, 8),
    deadlines: sanitizeDeadlines(entities.deadlines).slice(0, 8),
    clauses: [],
  };
}

export function mergeFactsFromParsed(
  parsed: Partial<ExtractedFacts> | null | undefined,
  baseline: ExtractedFacts,
): ExtractedFacts {
  if (!parsed) return baseline;
  return {
    date: asString(parsed.date) || baseline.date,
    dates: sliceList(
      mergeUniqueStrings(asStringArray(parsed.dates), baseline.dates),
      8,
    ),
    people: sliceList(asStringArray(parsed.people), 8),
    organizations: sliceList(asStringArray(parsed.organizations), 8),
    amounts: sliceList(
      mergeUniqueStrings(asStringArray(parsed.amounts), baseline.amounts),
      8,
    ),
    deadlines: sanitizeDeadlines(
      mergeUniqueStrings(asStringArray(parsed.deadlines), baseline.deadlines),
    ).slice(0, 8),
    clauses: sliceList(asStringArray(parsed.clauses), 6),
  };
}

/**
 * Local First strict : dates / montants / personnes / orgs / échéances
 * = extraction locale uniquement (le LLM ne peut pas les écraser).
 */
export function mergeFactsLocalFirst(
  _parsed: Partial<ExtractedFacts> | null | undefined,
  baseline: ExtractedFacts,
): ExtractedFacts {
  return {
    date: baseline.date,
    dates: baseline.dates.slice(0, 8),
    people: baseline.people.slice(0, 8),
    organizations: baseline.organizations.slice(0, 8),
    amounts: baseline.amounts.slice(0, 8),
    deadlines: baseline.deadlines.slice(0, 8),
    clauses: baseline.clauses.slice(0, 6),
  };
}

export function parseImportantPointDrafts(raw: unknown): ImportantPointDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: ImportantPointDraft[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      // String seule = conclusion sans preuve → ignorée au verify
      out.push({ statement: item.trim(), excerpt: "" });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const statement =
      typeof o.statement === "string"
        ? o.statement.trim()
        : typeof o.text === "string"
          ? o.text.trim()
          : typeof o.point === "string"
            ? o.point.trim()
            : "";
    const excerpt =
      typeof o.excerpt === "string"
        ? o.excerpt.trim()
        : typeof o.citation === "object" &&
            o.citation !== null &&
            typeof (o.citation as { excerpt?: unknown }).excerpt === "string"
          ? String((o.citation as { excerpt: string }).excerpt).trim()
          : "";
    if (!statement) continue;
    out.push({ statement, excerpt });
  }
  return out.slice(0, 8);
}

export function parseLegalFromParsed(
  parsed: (Partial<LegalAnalysis> & { important_points?: unknown }) | null | undefined,
  fallback: LegalAnalysis,
): LegalAnalysis {
  if (!parsed) return fallback;
  if (!(parsed.title || parsed.summary || parsed.document_type)) return fallback;
  const drafts = parseImportantPointDrafts(parsed.important_points);
  return {
    document_type: asString(parsed.document_type) || fallback.document_type,
    title: asString(parsed.title) || fallback.title,
    summary: asString(parsed.summary) || fallback.summary,
    important_points: drafts.map((d) => d.statement),
    important_point_drafts: drafts,
  };
}

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

export function parseRiskFindings(raw: unknown): RiskFinding[] {
  if (!Array.isArray(raw)) return [];
  const out: RiskFinding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const description =
      typeof o.description === "string" ? o.description.trim() : "";
    if (!description) continue;
    const criterionRaw =
      typeof o.criterion_id === "string" ? o.criterion_id.trim() : "";
    const severityRaw =
      typeof o.severity === "string" ? o.severity.trim() : "modere";
    const explanations = normalizeRiskExplanations(o);
    out.push({
      description,
      ...explanations,
      excerpt: typeof o.excerpt === "string" ? o.excerpt.trim() : "",
      confidence: asConfidence(o.confidence),
      severity: isRiskSeverity(severityRaw) ? severityRaw : "modere",
      criterion_id: isRiskCriterionId(criterionRaw) ? criterionRaw : undefined,
      status: "ambiguous",
      related_to:
        typeof o.related_to === "string" ? o.related_to.trim() : undefined,
    });
  }
  return out.slice(0, 8);
}

/** Actions déterministes à partir des risques / échéances (rapide, cohérent). */
export function buildDeterministicActions(input: {
  risks: string[];
  findings: RiskFinding[];
  deadlines: string[];
}): string[] {
  const actions: string[] = [];
  for (const d of input.deadlines.slice(0, 3)) {
    actions.push(`Anticiper l'échéance : ${d}`);
  }
  for (const f of input.findings.slice(0, 4)) {
    const mitigation = f.mitigation.trim();
    if (mitigation.length >= 8) {
      if (!actions.some((a) => a.includes(mitigation.slice(0, 28)))) {
        actions.push(mitigation);
      }
      continue;
    }
    const label = f.description.trim();
    if (!label) continue;
    const action = `Vérifier et traiter le risque : ${label}`;
    if (!actions.some((a) => a.includes(label.slice(0, 24)))) {
      actions.push(action);
    }
  }
  if (actions.length === 0) {
    for (const label of input.risks.slice(0, 3)) {
      actions.push(`Vérifier et traiter le risque : ${label}`);
    }
  }
  return actions.slice(0, 6);
}
