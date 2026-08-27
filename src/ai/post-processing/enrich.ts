import { mergeUniqueStrings } from "@/lib/array";
import {
  extractDocumentEntities,
  filterAmountsForDisplay,
  sanitizeDeadlines,
  scrubDisplayProse,
} from "@/ai/extraction";
import {
  cleanActionsForDisplay,
  cleanExcerptForDisplay,
  cleanSummaryForDisplay,
} from "@/ai/post-processing/display-cleanup";
import {
  projectVerifiedAnalysis,
  verifyAnalysisDraft,
  type AnalysisDraft,
  type VerificationReport,
} from "@/ai/reasoning";
import { mergeWithLocalRiskFindings } from "@/ai/post-processing/inject-local-risk-findings";
import { filterGenericImportantPoints } from "@/ai/post-processing/watch-ranking";
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

function scrubFindingForDisplay(f: {
  description: string;
  why?: string;
  implication?: string;
  consequence?: string;
  mitigation?: string;
  excerpt?: string;
  citation?: { excerpt?: string; page?: number; paragraph?: number };
}): typeof f {
  const scrubExcerpt = (raw: string | undefined): string => {
    if (!raw?.trim()) return "";
    const scrubbed = scrubDisplayProse(raw);
    return cleanExcerptForDisplay(scrubbed) ?? scrubbed.trim();
  };

  const excerpt = scrubExcerpt(f.excerpt);
  const citation = f.citation
    ? {
        ...f.citation,
        excerpt: scrubExcerpt(f.citation.excerpt),
      }
    : f.citation;

  return {
    ...f,
    description: scrubDisplayProse(f.description),
    why: f.why ? scrubDisplayProse(f.why) : f.why,
    implication: f.implication
      ? scrubDisplayProse(f.implication)
      : f.implication,
    consequence: f.consequence
      ? scrubDisplayProse(f.consequence)
      : f.consequence,
    mitigation: f.mitigation
      ? scrubDisplayProse(f.mitigation)
      : f.mitigation,
    excerpt,
    citation,
  };
}

function scrubAnalysisProseAmounts<T extends {
  summary: string;
  important_points: string[];
  risks?: string[];
  actions?: string[];
  risk_explanation?: string;
  risk_findings?: Array<{
    description: string;
    why?: string;
    implication?: string;
    consequence?: string;
    mitigation?: string;
    excerpt?: string;
    citation?: { excerpt?: string; page?: number; paragraph?: number };
  }>;
}>(analysis: T): T {
  return {
    ...analysis,
    summary: scrubDisplayProse(analysis.summary),
    important_points: analysis.important_points.map((p) =>
      scrubDisplayProse(p),
    ),
    risks: analysis.risks?.map((r) => scrubDisplayProse(r)),
    actions: analysis.actions?.map((a) => scrubDisplayProse(a)),
    risk_explanation: analysis.risk_explanation
      ? scrubDisplayProse(analysis.risk_explanation)
      : analysis.risk_explanation,
    risk_findings: analysis.risk_findings?.map(scrubFindingForDisplay),
  };
}

/** Scrub prose bruit (#1ter) — utilisé par enrich et verify (pipeline prod). */
export function scrubAnalysisForDisplay(
  analysis: DocumentAnalysis,
): DocumentAnalysis {
  const scrubbed = scrubAnalysisProseAmounts(analysis);
  const summary =
    cleanSummaryForDisplay(scrubbed.summary) ||
    scrubbed.summary.trim() ||
    analysis.summary;

  return {
    ...scrubbed,
    summary,
    actions: cleanActionsForDisplay(scrubbed.actions ?? []),
  };
}

function stripInternalFields(
  analysis: ParsedAnalysis,
): Omit<ParsedAnalysis, "_reasoning" | "_self_check"> {
  const { _reasoning: _r, _self_check: _s, ...clean } = analysis;
  void _r;
  void _s;
  return clean;
}

function actionsFromDeadlines(deadlines: string[]): string[] {
  return cleanActionsForDisplay(
    deadlines.slice(0, 4).map((deadline) => {
      const clean = deadline.trim();
      if (
        /^v[ée]rifier|^anticiper|^adresser|^contester|^n[ée]gocier|^demander/i.test(
          clean,
        )
      ) {
        return clean;
      }
      return `Anticiper l'échéance : ${clean}`;
    }),
  );
}

function mergeEntities(
  analysis: ParsedAnalysis,
  documentText: string,
  classification: DocumentClassification,
): ParsedAnalysis {
  const entities = extractDocumentEntities(documentText);
  // Source de vérité montants = extraction labelisée locale (pas la liste brute LLM).
  const rawAmounts =
    entities.amounts.length > 0
      ? entities.amounts
      : analysis.amounts;
  const amounts = filterAmountsForDisplay(rawAmounts);

  return {
    ...analysis,
    document_type: analysis.document_type || classification.label,
    date: analysis.date || entities.primaryDate,
    dates: mergeUniqueStrings(
      analysis.dates,
      analysis.date ? [analysis.date] : [],
      entities.dates,
    ),
    amounts,
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
  const actions = cleanActionsForDisplay(
    enrichedBase.actions.length > 0
      ? enrichedBase.actions.slice(0, 8)
      : actionsFromDeadlines(enrichedBase.deadlines),
  );

  const clean = scrubAnalysisProseAmounts(stripInternalFields(enrichedBase));

  return {
    ...clean,
    summary:
      cleanSummaryForDisplay(clean.summary) ||
      "Résumé indisponible — texte incomplet écarté.",
    risks,
    actions,
    important_points: filterGenericImportantPoints(
      clean.important_points ?? [],
    ).slice(0, 8),
    ...risk,
  };
}

function enrichReasoning(
  enrichedBase: ParsedAnalysis,
  documentText: string,
  classification: DocumentClassification,
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
    important_points: filterGenericImportantPoints(
      enrichedBase.important_points,
    ).slice(0, 8),
    risks: enrichedBase.risks,
    actions: enrichedBase.actions,
    risk_findings: mergeWithLocalRiskFindings(
      enrichedBase.risk_findings,
      documentText,
      {
        category: classification.category,
        documentType: enrichedBase.document_type,
        title: enrichedBase.title,
      },
    ),
    _reasoning: enrichedBase._reasoning,
    _self_check: enrichedBase._self_check,
  };

  const verified = verifyAnalysisDraft(draft, documentText);
  let analysis = scrubAnalysisProseAmounts(projectVerifiedAnalysis(verified));

  analysis = {
    ...analysis,
    summary:
      cleanSummaryForDisplay(analysis.summary) ||
      "Résumé indisponible — texte incomplet écarté.",
    important_points: filterGenericImportantPoints(
      analysis.important_points ?? [],
    ).slice(0, 8),
    actions: cleanActionsForDisplay(
      analysis.actions.length > 0
        ? analysis.actions
        : actionsFromDeadlines(analysis.deadlines),
    ),
  };

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
  const familyCtx = {
    category: classification.category,
    documentType: enrichedBase.document_type,
    title: enrichedBase.title,
  };
  const mergedFindings = mergeWithLocalRiskFindings(
    enrichedBase.risk_findings,
    documentText,
    familyCtx,
  );

  if (isReasoningModeEnabled() && mergedFindings.length > 0) {
    return enrichReasoning(
      { ...enrichedBase, risk_findings: mergedFindings },
      documentText,
      classification,
    );
  }

  return {
    analysis: enrichLegacyRegex(enrichedBase, documentText),
  };
}
