import { checkAnalysisCoherence } from "@/ai/agents";
import {
  AGENT_EVAL_STEPS,
  type AgentEvalId,
  type AgentStepEval,
  type FieldComparison,
  type FieldStatus,
} from "@/types/eval";
import type { DocumentAnalysis, DocumentClassification } from "@/types";

function statusFromScore(score: number): FieldStatus {
  if (score >= 0.85) return "correct";
  if (score >= 0.45) return "partial";
  if (score <= 0) return "omission";
  return "error";
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function scoreVerifyAgent(analysis: DocumentAnalysis): AgentStepEval {
  const notes: string[] = [];
  const issues = checkAnalysisCoherence(analysis);
  let score = 1;

  if (issues.length > 0) {
    score -= Math.min(0.7, issues.length * 0.12);
    notes.push(
      ...issues.map((i) => `Cohérence ${i.field}: ${i.message}`),
    );
  } else {
    notes.push("JSON cohérent (champs, score, critères).");
  }

  const findings = analysis.risk_findings ?? [];
  const confirmed = findings.filter((f) => f.status === "confirmed");
  const ambiguous = findings.filter((f) => f.status === "ambiguous");

  if (findings.length > 0) {
    const withCitation = findings.filter(
      (f) =>
        f.citation &&
        f.citation.excerpt.trim().length >= 8 &&
        f.citation.page >= 1 &&
        f.citation.paragraph >= 1,
    );
    const citationRatio = withCitation.length / findings.length;
    score = score * 0.65 + citationRatio * 0.35;
    notes.push(
      `Findings: ${confirmed.length} confirmés, ${ambiguous.length} ambigus, ${withCitation.length}/${findings.length} avec citation (page/§/extrait).`,
    );

    if (confirmed.length > 0) {
      const risksCovered = confirmed.filter((f) =>
        analysis.risks.some(
          (r) =>
            r.toLowerCase().includes(f.description.toLowerCase().slice(0, 20)) ||
            f.description.toLowerCase().includes(r.toLowerCase().slice(0, 20)),
        ),
      ).length;
      const cover = risksCovered / confirmed.length;
      score = score * 0.75 + cover * 0.25;
      if (cover < 1) {
        notes.push(
          `Projection risks[] incomplète (${risksCovered}/${confirmed.length}).`,
        );
      }
    }
  } else {
    notes.push("Pas de risk_findings structurés (vérif limitée aux champs).");
    score *= 0.9;
  }

  const criteriaSum = analysis.risk_criteria.reduce((t, c) => t + c.score, 0);
  if (Math.abs(criteriaSum - analysis.risk_score) > 1) {
    score *= 0.85;
    notes.push(
      `Écart score (${analysis.risk_score}) vs somme critères (${criteriaSum}).`,
    );
  }

  score = Math.min(1, Math.max(0, score));

  return {
    id: "verify",
    label: "Vérification finale",
    score,
    status: statusFromScore(score),
    detail: `Cohérence ${issues.length === 0 ? "OK" : `${issues.length} problème(s)`}`,
    fieldScores: [],
    notes,
  };
}

/**
 * Agrège les scores champs → scores par agent,
 * + score dédié pour la vérification finale.
 */
export function scoreAgents(input: {
  fields: FieldComparison[];
  analysis?: DocumentAnalysis;
  classification?: DocumentClassification;
}): AgentStepEval[] {
  const byField = new Map(input.fields.map((f) => [f.field, f]));

  const steps: AgentStepEval[] = AGENT_EVAL_STEPS.map((step) => {
    if (step.id === "verify") {
      if (input.analysis) {
        return scoreVerifyAgent(input.analysis);
      }
      return {
        id: "verify",
        label: step.label,
        score: 0,
        status: "omission" as const,
        detail: "Analyse absente — vérification non scorée.",
        fieldScores: [],
        notes: ["Pas d'analyse à vérifier."],
      };
    }

    const fieldScores = step.fields.map((field) => {
      const cmp = byField.get(field);
      return {
        field,
        score: cmp?.score ?? 0,
        status: cmp?.status ?? ("omission" as FieldStatus),
        detail: cmp?.detail ?? "Champ non comparé",
      };
    });

    const score = average(fieldScores.map((f) => f.score));
    const notes: string[] = [];

    if (step.id === "classify" && input.classification) {
      notes.push(
        `Classe API: ${input.classification.label} (confiance ${(input.classification.confidence * 100).toFixed(0)} %).`,
      );
    }

    if (step.id === "risks" && input.analysis?.risk_findings?.length) {
      notes.push(
        `${input.analysis.risk_findings.length} finding(s) structurés renvoyés.`,
      );
    }

    return {
      id: step.id as AgentEvalId,
      label: step.label,
      score,
      status: statusFromScore(score),
      detail:
        fieldScores.length === 1
          ? fieldScores[0]!.detail
          : `Moyenne sur ${fieldScores.length} champs`,
      fieldScores,
      notes,
    };
  });

  return steps;
}

export function averageAgentScore(agents: AgentStepEval[]): number {
  if (agents.length === 0) return 0;
  return average(agents.map((a) => a.score));
}

export function averageAgentScoresById(
  results: { success: boolean; agents?: AgentStepEval[] }[],
): Record<AgentEvalId, number> {
  const out = {} as Record<AgentEvalId, number>;
  for (const step of AGENT_EVAL_STEPS) {
    const scores = results
      .filter((r) => r.success && r.agents)
      .map((r) => r.agents!.find((a) => a.id === step.id)?.score)
      .filter((s): s is number => typeof s === "number");
    out[step.id] = average(scores);
  }
  return out;
}
