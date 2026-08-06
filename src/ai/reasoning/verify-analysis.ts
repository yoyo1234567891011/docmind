import { getOptimizationConfig } from "@/config/optimizations";
import {
  buildDocumentLocusIndex,
  locateExcerptCitation,
} from "@/ai/reasoning/citations";
import { excerptExistsInDocument } from "@/ai/reasoning/normalize-text";
import { sanitizeDeadlines } from "@/ai/extraction";
import type { CitedConclusion } from "@/types/citation";
import {
  hasRiskExplanations,
  isRiskCriterionId,
  isRiskSeverity,
  normalizeRiskExplanations,
  type RiskFinding,
  type RiskSeverity,
} from "@/types";

export type ImportantPointDraft = {
  statement: string;
  excerpt: string;
};

export type AnalysisDraft = {
  document_type: string;
  title: string;
  summary: string;
  date: string;
  dates: string[];
  people: string[];
  organizations: string[];
  amounts: string[];
  deadlines: string[];
  important_points: string[];
  /** Broillons avec extrait (avant citation résolue) */
  important_point_drafts?: ImportantPointDraft[];
  risks: string[];
  actions: string[];
  risk_findings?: RiskFinding[];
  _reasoning?: string;
  _self_check?: unknown;
};

export type VerificationReport = {
  findings_in: number;
  confirmed: number;
  ambiguous: number;
  rejected: number;
  actions_dropped: number;
  deadlines_dropped: number;
  important_points_dropped: number;
  notes: string[];
};

export type VerifiedAnalysisDraft = AnalysisDraft & {
  risk_findings: RiskFinding[];
  important_point_findings: CitedConclusion[];
  _verification: VerificationReport;
};

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

function normalizeSeverity(value: unknown): RiskSeverity {
  if (typeof value === "string" && isRiskSeverity(value)) return value;
  const map: Record<string, RiskSeverity> = {
    low: "faible",
    medium: "modere",
    moderate: "modere",
    high: "eleve",
    critical: "critique",
  };
  if (typeof value === "string" && map[value.toLowerCase()]) {
    return map[value.toLowerCase()];
  }
  return "modere";
}

function coerceFinding(raw: unknown): RiskFinding | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const description =
    typeof o.description === "string" ? o.description.trim() : "";
  if (!description) return null;

  const criterionRaw =
    typeof o.criterion_id === "string"
      ? o.criterion_id.trim()
      : typeof o.criterionId === "string"
        ? o.criterionId.trim()
        : "";

  const excerpt =
    typeof o.excerpt === "string"
      ? o.excerpt.trim()
      : typeof o.citation === "object" &&
          o.citation !== null &&
          typeof (o.citation as { excerpt?: unknown }).excerpt === "string"
        ? String((o.citation as { excerpt: string }).excerpt).trim()
        : "";

  const explanations = normalizeRiskExplanations(o);

  return {
    description,
    ...explanations,
    excerpt,
    confidence: asConfidence(o.confidence),
    severity: normalizeSeverity(o.severity),
    criterion_id: isRiskCriterionId(criterionRaw) ? criterionRaw : undefined,
    status: "ambiguous",
    related_to:
      typeof o.related_to === "string"
        ? o.related_to.trim()
        : typeof o.relatedTo === "string"
          ? o.relatedTo.trim()
          : undefined,
  };
}

function actionLinkedToConfirmedOrDeadline(
  action: string,
  confirmed: RiskFinding[],
  deadlines: string[],
): boolean {
  const a = action.toLowerCase();
  if (!a.trim()) return false;

  for (const d of deadlines) {
    const token = d.toLowerCase().slice(0, 40);
    if (token.length >= 6 && a.includes(token)) return true;
    const dateBits = d.match(/\d{1,4}[./-]\d{1,2}[./-]\d{1,4}/g) ?? [];
    if (dateBits.some((bit) => a.includes(bit.toLowerCase()))) return true;
  }

  for (const f of confirmed) {
    if (f.related_to && a.includes(f.related_to.toLowerCase())) return true;
    const key = f.description.toLowerCase().slice(0, 28);
    if (key.length >= 8 && a.includes(key)) return true;
    const excerptBits = (f.citation?.excerpt || f.excerpt)
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 5)
      .slice(0, 4);
    const hits = excerptBits.filter((t) => a.includes(t)).length;
    if (excerptBits.length >= 2 && hits >= 2) return true;
  }

  const anchors = [
    "échéance",
    "echeance",
    "résil",
    "resil",
    "délai",
    "delai",
    "avant le",
    "vérifier",
    "contester",
    "négocier",
    "negocier",
  ];
  if (confirmed.length > 0 && anchors.some((w) => a.includes(w))) return true;

  return false;
}

function verifyImportantPoints(
  draft: AnalysisDraft,
  loci: ReturnType<typeof buildDocumentLocusIndex>,
  notes: string[],
): { kept: CitedConclusion[]; dropped: number } {
  const drafts: ImportantPointDraft[] = [];

  if (Array.isArray(draft.important_point_drafts)) {
    drafts.push(...draft.important_point_drafts);
  }

  // Compat : strings seules → rejet (pas de preuve)
  for (const point of draft.important_points ?? []) {
    if (typeof point !== "string" || !point.trim()) continue;
    const already = drafts.some((d) => d.statement === point.trim());
    if (!already) {
      drafts.push({ statement: point.trim(), excerpt: "" });
    }
  }

  const kept: CitedConclusion[] = [];
  let dropped = 0;

  for (const item of drafts) {
    const statement = item.statement.trim();
    const excerpt = item.excerpt.trim();
    if (!statement) {
      dropped += 1;
      continue;
    }
    if (excerpt.length < 8) {
      dropped += 1;
      notes.push(`dropped(important_point sans extrait): ${statement.slice(0, 50)}`);
      continue;
    }
    const citation = locateExcerptCitation(excerpt, loci);
    if (!citation) {
      dropped += 1;
      notes.push(
        `dropped(important_point preuve introuvable): ${statement.slice(0, 50)}`,
      );
      continue;
    }
    kept.push({ statement, citation });
  }

  return { kept: kept.slice(0, 8), dropped };
}

/**
 * Auto-vérification serveur — aucune conclusion sans citation localisée.
 */
export function verifyAnalysisDraft(
  draft: AnalysisDraft,
  documentText: string,
  pages?: string[],
): VerifiedAnalysisDraft {
  const { minConfidenceConfirmed } =
    getOptimizationConfig().reasoningMode;
  const notes: string[] = [];
  const loci = buildDocumentLocusIndex(pages, documentText);

  const rawFindings = Array.isArray(draft.risk_findings)
    ? draft.risk_findings
    : [];

  // Sans finding structuré, risks[] seuls = conclusions sans preuve → ignorés
  const seed: unknown[] = rawFindings.length > 0 ? rawFindings : [];
  if (rawFindings.length === 0 && (draft.risks?.length ?? 0) > 0) {
    notes.push(
      `rejected(all risks without findings): ${draft.risks.length} libellé(s) sans extrait`,
    );
  }

  const verifiedFindings: RiskFinding[] = [];

  for (const raw of seed) {
    const finding = coerceFinding(raw);
    if (!finding) continue;

    const selfCheckRejected =
      typeof draft._self_check === "object" &&
      draft._self_check !== null &&
      Array.isArray(
        (draft._self_check as { contradicted?: unknown }).contradicted,
      ) &&
      (
        (draft._self_check as { contradicted: unknown[] }).contradicted as unknown[]
      ).some(
        (c) =>
          typeof c === "string" &&
          c
            .toLowerCase()
            .includes(finding.description.toLowerCase().slice(0, 20)),
      );

    if (selfCheckRejected) {
      verifiedFindings.push({ ...finding, status: "rejected" });
      notes.push(`rejected(self_check): ${finding.description.slice(0, 60)}`);
      continue;
    }

    const citation = locateExcerptCitation(finding.excerpt, loci);
    if (!citation) {
      verifiedFindings.push({ ...finding, status: "rejected" });
      notes.push(
        `rejected(sans preuve): ${finding.description.slice(0, 60)}`,
      );
      continue;
    }

    const withCitation: RiskFinding = {
      ...finding,
      excerpt: citation.excerpt,
      citation,
    };

    if (!withCitation.criterion_id && withCitation.confidence < minConfidenceConfirmed) {
      verifiedFindings.push({ ...withCitation, status: "rejected" });
      notes.push(`rejected(no_criterion): ${withCitation.description.slice(0, 60)}`);
      continue;
    }

    if (withCitation.confidence < minConfidenceConfirmed) {
      verifiedFindings.push({ ...withCitation, status: "ambiguous" });
      notes.push(`ambiguous(confidence): ${withCitation.description.slice(0, 60)}`);
      continue;
    }

    if (!hasRiskExplanations(withCitation)) {
      verifiedFindings.push({ ...withCitation, status: "ambiguous" });
      notes.push(
        `ambiguous(explications incomplètes): ${withCitation.description.slice(0, 60)}`,
      );
      continue;
    }

    verifiedFindings.push({ ...withCitation, status: "confirmed" });
  }

  const confirmed = verifiedFindings.filter((f) => f.status === "confirmed");

  const { kept: important_point_findings, dropped: important_points_dropped } =
    verifyImportantPoints(draft, loci, notes);

  const deadlinesBefore = draft.deadlines ?? [];
  const deadlines = sanitizeDeadlines(deadlinesBefore).filter(
    (d) =>
      excerptExistsInDocument(d, documentText) ||
      normalizeLooseDeadlineInDoc(d, documentText),
  );
  const deadlines_dropped = Math.max(
    0,
    deadlinesBefore.length - deadlines.length,
  );

  const actionsBefore = draft.actions ?? [];
  const actions = actionsBefore.filter((a) =>
    actionLinkedToConfirmedOrDeadline(a, confirmed, deadlines),
  );
  const actions_dropped = Math.max(0, actionsBefore.length - actions.length);

  const risks = confirmed.map((f) => f.description).slice(0, 12);
  const important_points = important_point_findings.map((p) => p.statement);

  const report: VerificationReport = {
    findings_in: seed.length,
    confirmed: confirmed.length,
    ambiguous: verifiedFindings.filter((f) => f.status === "ambiguous").length,
    rejected: verifiedFindings.filter((f) => f.status === "rejected").length,
    actions_dropped,
    deadlines_dropped,
    important_points_dropped,
    notes,
  };

  const {
    _reasoning: _r,
    _self_check: _s,
    important_point_drafts: _d,
    ...rest
  } = draft;

  return {
    ...rest,
    deadlines,
    actions,
    risks,
    important_points,
    important_point_findings,
    risk_findings: verifiedFindings.filter((f) => f.status !== "rejected"),
    _verification: report,
  };
}

function normalizeLooseDeadlineInDoc(deadline: string, doc: string): boolean {
  const bits =
    deadline.match(
      /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g,
    ) ?? [];
  if (bits.length === 0) {
    return excerptExistsInDocument(deadline.slice(0, 80), doc);
  }
  return bits.some((b) => doc.toLowerCase().includes(b.toLowerCase()));
}
