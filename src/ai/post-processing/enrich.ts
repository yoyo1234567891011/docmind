import { mergeUniqueStrings } from "@/lib/array";
import {
  extractDocumentEntities,
  sanitizeDeadlines,
} from "@/ai/extraction";
import {
  projectVerifiedAnalysis,
  verifyAnalysisDraft,
  type AnalysisDraft,
  type VerificationReport,
} from "@/ai/reasoning";
import {
  assessDocumentRisk,
  buildLegalRiskFindings,
} from "@/ai/scoring";
import { isReasoningModeEnabled } from "@/config/optimizations";
import type { DocumentAnalysis, DocumentClassification } from "@/types";

type ParsedAnalysis = Omit<
  DocumentAnalysis,
  "risk_score" | "risk_level" | "risk_explanation" | "risk_criteria"
> & {
  _reasoning?: string;
  _self_check?: unknown;
};

export type EnrichAnalysisResult = {
  analysis: DocumentAnalysis;
  verification?: VerificationReport;
};

function actionsFromDeadlines(deadlines: string[]): string[] {
  return deadlines.slice(0, 4).map((deadline) => {
    const clean = deadline.trim();
    if (/^v[ée]rifier|^anticiper|^adresser|^contester|^n[ée]gocier|^demander/i.test(clean)) {
      return clean;
    }
    return `Anticiper l'échéance : ${clean}`;
  });
}

function mergeEntities(
  analysis: ParsedAnalysis,
  documentText: string,
  classification: DocumentClassification,
): ParsedAnalysis {
  const entities = extractDocumentEntities(documentText);

  return {
    ...analysis,
    document_type: analysis.document_type || classification.label,
    date: analysis.date || entities.primaryDate,
    dates: mergeUniqueStrings(
      analysis.dates,
      analysis.date ? [analysis.date] : [],
      entities.dates,
    ),
    amounts: mergeUniqueStrings(analysis.amounts, entities.amounts),
    deadlines: sanitizeDeadlines(
      mergeUniqueStrings(analysis.deadlines, entities.deadlines),
    ),
  };
}

function enrichLegacyRegex(
  enrichedBase: ParsedAnalysis,
  documentText: string,
): DocumentAnalysis {
  const risk = assessDocumentRisk(enrichedBase, documentText);
  const legalRisks = buildLegalRiskFindings(risk.risk_criteria).map((item) =>
    item.replace(/^\[([^\]]+)\]\s*/, "$1 : "),
  );

  const risks = mergeUniqueStrings(enrichedBase.risks, legalRisks).slice(0, 8);
  const actions =
    enrichedBase.actions.length > 0
      ? enrichedBase.actions.slice(0, 8)
      : actionsFromDeadlines(enrichedBase.deadlines);

  const { _reasoning: _r, _self_check: _s, ...clean } = enrichedBase;

  return {
    ...clean,
    risks,
    actions,
    important_points: enrichedBase.important_points.slice(0, 8),
    ...risk,
  };
}

function enrichReasoning(
  enrichedBase: ParsedAnalysis,
  documentText: string,
): EnrichAnalysisResult {
  const draft: AnalysisDraft = {
    document_type: enrichedBase.document_type,
    title: enrichedBase.title,
    summary: enrichedBase.summary,
    date: enrichedBase.date,
    dates: enrichedBase.dates,
    people: enrichedBase.people,
    organizations: enrichedBase.organizations,
    amounts: enrichedBase.amounts,
    deadlines: enrichedBase.deadlines,
    important_points: enrichedBase.important_points.slice(0, 8),
    risks: enrichedBase.risks,
    actions: enrichedBase.actions,
    risk_findings: enrichedBase.risk_findings,
    _reasoning: enrichedBase._reasoning,
    _self_check: enrichedBase._self_check,
  };

  const verified = verifyAnalysisDraft(draft, documentText);
  let analysis = projectVerifiedAnalysis(verified);

  if (analysis.actions.length === 0 && analysis.deadlines.length > 0) {
    analysis = {
      ...analysis,
      actions: actionsFromDeadlines(analysis.deadlines),
    };
  }

  return {
    analysis,
    verification: verified._verification,
  };
}

/**
 * Post-processing: merge LLM output with deterministic extraction, then score.
 * Mode raisonnement : verify serveur + score pondéré (pas de merge regex risques).
 * Fallback regex : salvage / anciennes analyses sans risk_findings.
 */
export function enrichAnalysisWithExtractedEntities(
  analysis: ParsedAnalysis,
  documentText: string,
  classification: DocumentClassification,
): DocumentAnalysis {
  return enrichAnalysisDetailed(analysis, documentText, classification)
    .analysis;
}

/** Variante avec rapport d'auto-vérification (log pipeline). */
export function enrichAnalysisDetailed(
  analysis: ParsedAnalysis,
  documentText: string,
  classification: DocumentClassification,
): EnrichAnalysisResult {
  const enrichedBase = mergeEntities(analysis, documentText, classification);
  const hasStructuredFindings =
    Array.isArray(enrichedBase.risk_findings) &&
    enrichedBase.risk_findings.length > 0;

  if (isReasoningModeEnabled() && hasStructuredFindings) {
    return enrichReasoning(enrichedBase, documentText);
  }

  return {
    analysis: enrichLegacyRegex(enrichedBase, documentText),
  };
}
