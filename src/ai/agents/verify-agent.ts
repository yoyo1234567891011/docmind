import { verifyAnalysisDraft } from "@/ai/reasoning/verify-analysis";
import { scrubAnalysisForDisplay } from "@/ai/post-processing/enrich";
import { mergeWithLocalRiskFindings } from "@/ai/post-processing/inject-local-risk-findings";
import { rankFindingsForWatch } from "@/ai/post-processing/watch-ranking";
import { scoreRiskFromFindings } from "@/services/risk/score-from-findings";
import { assessDocumentRisk } from "@/ai/scoring";
import { hasRiskExplanations, type DocumentAnalysis, type RiskFinding } from "@/types";
import type { AnalysisAgent, AgentResult } from "./types";
import { pushAgentStep } from "./utils";

type CoherenceIssue = {
  field: string;
  message: string;
};

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

/**
 * Contrôles de cohérence du JSON final (déterministe).
 */
export function checkAnalysisCoherence(
  analysis: DocumentAnalysis,
): CoherenceIssue[] {
  const issues: CoherenceIssue[] = [];

  if (!analysis.document_type?.trim()) {
    issues.push({ field: "document_type", message: "manquant" });
  }
  if (!analysis.title?.trim()) {
    issues.push({ field: "title", message: "manquant" });
  }
  if (!analysis.summary?.trim()) {
    issues.push({ field: "summary", message: "manquant" });
  }

  for (const key of [
    "dates",
    "people",
    "organizations",
    "amounts",
    "deadlines",
    "important_points",
    "risks",
    "actions",
  ] as const) {
    if (!Array.isArray(analysis[key])) {
      issues.push({ field: key, message: "doit être un tableau" });
    }
  }

  if (
    typeof analysis.risk_score !== "number" ||
    analysis.risk_score < 0 ||
    analysis.risk_score > 100
  ) {
    issues.push({ field: "risk_score", message: "hors plage 0..100" });
  }

  if (!Array.isArray(analysis.risk_criteria) || analysis.risk_criteria.length === 0) {
    issues.push({ field: "risk_criteria", message: "critères absents" });
  }

  const criteriaSum = (analysis.risk_criteria ?? []).reduce(
    (t, c) => t + (c?.score ?? 0),
    0,
  );
  if (
    analysis.risk_criteria?.length &&
    Math.abs(criteriaSum - analysis.risk_score) > 1
  ) {
    issues.push({
      field: "risk_score",
      message: `incohérent avec somme critères (${criteriaSum})`,
    });
  }

  const confirmed = (analysis.risk_findings ?? []).filter(
    (f) => f.status === "confirmed",
  );
  if (confirmed.length > 0 && analysis.risks.length === 0) {
    issues.push({
      field: "risks",
      message: "findings confirmés sans risks[]",
    });
  }

  for (const f of confirmed) {
    if (!f.citation?.excerpt || f.citation.page < 1 || f.citation.paragraph < 1) {
      issues.push({
        field: "risk_findings",
        message: `conclusion sans citation: ${f.description.slice(0, 40)}`,
      });
    }
    if (!hasRiskExplanations(f)) {
      issues.push({
        field: "risk_findings",
        message: `explications incomplètes: ${f.description.slice(0, 40)}`,
      });
    }
  }

  for (const p of analysis.important_point_findings ?? []) {
    if (!p.citation?.excerpt || p.citation.page < 1 || p.citation.paragraph < 1) {
      issues.push({
        field: "important_point_findings",
        message: `point sans citation: ${p.statement.slice(0, 40)}`,
      });
    }
  }

  return issues;
}

function assembleDraft(state: Parameters<AnalysisAgent["run"]>[0]) {
  const facts = state.facts;
  const legal = state.legal;
  return {
    document_type: legal?.document_type || state.classification?.label || "",
    title: legal?.title || state.fileName?.replace(/\.pdf$/i, "") || "",
    summary: legal?.summary || "",
    date: facts?.date || "",
    dates: facts?.dates || [],
    people: facts?.people || [],
    organizations: facts?.organizations || [],
    amounts: facts?.amounts || [],
    deadlines: facts?.deadlines || [],
    important_points: legal?.important_points || [],
    important_point_drafts: legal?.important_point_drafts,
    risks: state.risks || [],
    actions: state.actions || [],
    // Injection locale avant verify : score + « Points à surveiller ».
    risk_findings: mergeWithLocalRiskFindings(
      state.risk_findings,
      state.documentText,
      {
        category: state.classification?.category,
        documentType: legal?.document_type,
        title: legal?.title,
        textHint: state.documentText?.slice(0, 1200),
      },
    ),
  };
}

/** Agent 7 — Vérification finale + assemblage JSON. */
export const verifyAgent: AnalysisAgent = {
  id: "verify",
  label: "Vérification finale",
  kind: "deterministic",

  async run(state): Promise<AgentResult> {
    const started = Date.now();
    const draft = assembleDraft(state);

    const verified = verifyAnalysisDraft(
      draft,
      state.documentText,
      state.pages,
    );
    let findings: RiskFinding[] = verified.risk_findings ?? [];
    const watchCtx = {
      category: state.classification?.category,
      documentType: verified.document_type,
      title: verified.title,
      textHint: state.documentText?.slice(0, 1200),
    };
    const rankable = findings.filter((f) => f.status !== "rejected");
    const rejectedFindings = findings.filter((f) => f.status === "rejected");
    const rankedWatch = rankFindingsForWatch(rankable, watchCtx, 12);
    findings = [...rankedWatch, ...rejectedFindings];

    const confirmedCount = findings.filter((f) => f.status === "confirmed").length;

    // Score : findings confirmés ; sinon regex document (évite 0/100 si LLM ambigu seulement).
    const assessment =
      confirmedCount > 0
        ? scoreRiskFromFindings(findings)
        : assessDocumentRisk(
            {
              risks: verified.risks,
              important_points: verified.important_points,
              deadlines: verified.deadlines,
              actions: verified.actions,
            },
            state.documentText,
          );

    let analysis: DocumentAnalysis = {
      document_type: verified.document_type,
      title: verified.title,
      summary: verified.summary,
      date: verified.date,
      dates: ensureStringArray(verified.dates),
      people: ensureStringArray(verified.people),
      organizations: ensureStringArray(verified.organizations),
      amounts: ensureStringArray(verified.amounts),
      deadlines: ensureStringArray(verified.deadlines),
      important_points: ensureStringArray(verified.important_points),
      important_point_findings: verified.important_point_findings,
      risks: ensureStringArray(verified.risks),
      actions: ensureStringArray(verified.actions),
      risk_findings: findings,
      ...assessment,
    };

    // Auto-réparation cohérence mineure
    if (!analysis.title.trim()) {
      analysis = {
        ...analysis,
        title: state.fileName?.replace(/\.pdf$/i, "") || "Document",
      };
    }
    if (!analysis.document_type.trim()) {
      analysis = {
        ...analysis,
        document_type: state.classification?.label || "Document",
      };
    }
    if (!analysis.summary.trim()) {
      analysis = {
        ...analysis,
        summary: "Analyse multi-agents : résumé indisponible.",
      };
    }

    // Align risks[] sur confirmed
    const confirmed = findings.filter((f) => f.status === "confirmed");
    if (confirmed.length > 0) {
      analysis = {
        ...analysis,
        risks: confirmed.map((f) => f.description).slice(0, 8),
      };
    }

    let issues = checkAnalysisCoherence(analysis);

    // Resync score si somme critères ≠ score
    if (issues.some((i) => i.field === "risk_score" && i.message.includes("somme"))) {
      const sum = analysis.risk_criteria.reduce((t, c) => t + c.score, 0);
      analysis = { ...analysis, risk_score: Math.min(100, Math.max(0, Math.round(sum))) };
      issues = checkAnalysisCoherence(analysis);
    }

    analysis = scrubAnalysisForDisplay(analysis);

    const v = verified._verification;
    const note = [
      `confirmés=${v.confirmed} ambigus=${v.ambiguous} rejetés=${v.rejected}`,
      `actions_drop=${v.actions_dropped} échéances_drop=${v.deadlines_dropped}`,
      `points_drop=${v.important_points_dropped}`,
      issues.length
        ? `cohérence: ${issues.map((i) => `${i.field}:${i.message}`).join("; ")}`
        : "cohérence OK",
    ].join(" | ");

    const next = pushAgentStep(
      {
        ...state,
        risk_findings: findings,
        risks: analysis.risks,
        actions: analysis.actions,
        important_point_findings: verified.important_point_findings,
        assessment,
        analysis,
      },
      "verify",
      {
        durationMs: Date.now() - started,
        generation: null,
        ok: issues.length === 0,
        note,
        error: issues.length ? note : undefined,
      },
    );

    return {
      state: next,
      meta: {
        durationMs: Date.now() - started,
        ok: true,
        note,
      },
    };
  },
};
