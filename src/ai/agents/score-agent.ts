import { getOptimizationConfig } from "@/config/optimizations";
import { resolveWatchDocFamily } from "@/ai/post-processing/watch-ranking";
import { scoreRiskFromFindings } from "@/services/risk/score-from-findings";
import { assessDocumentRisk } from "@/ai/scoring";
import type { RiskCriterionId, RiskFinding } from "@/types";
import type { AnalysisAgent, AgentResult } from "./types";
import { pushAgentStep } from "./utils";

/**
 * Prépare les findings pour un scoring provisoire :
 * confidence ≥ seuil → treated as confirmed (le verify final tranche).
 */
function provisionalFindings(findings: RiskFinding[]): RiskFinding[] {
  const min = getOptimizationConfig().reasoningMode.minConfidenceConfirmed;
  return findings.map((f) => ({
    ...f,
    status:
      f.excerpt.length >= 8 && f.confidence >= min
        ? ("confirmed" as const)
        : f.confidence < min
          ? ("ambiguous" as const)
          : ("ambiguous" as const),
  }));
}

/** Critères hors sujet selon la famille documentaire (ex. résiliation sur relevé). */
function filterFindingsForScoring(
  findings: RiskFinding[],
  ctx: {
    category?: string | null;
    documentType?: string | null;
    title?: string | null;
    textHint?: string | null;
  },
): RiskFinding[] {
  const family = resolveWatchDocFamily(ctx);
  if (family !== "banque") return findings;

  const offTopic: RiskCriterionId[] = [
    "resiliation",
    "renouvellement_tacite",
    "engagement",
  ];
  return findings.filter((f) => !f.criterion_id || !offTopic.includes(f.criterion_id));
}

/** Agent 5 — Calcul du score de risque (déterministe). */
export const scoreAgent: AnalysisAgent = {
  id: "score",
  label: "Calcul du score de risque",
  kind: "deterministic",

  async run(state): Promise<AgentResult> {
    const started = Date.now();
    const findings = filterFindingsForScoring(state.risk_findings ?? [], {
      category: state.classification?.category,
      documentType: state.legal?.document_type,
      title: state.legal?.title ?? state.fileName,
      textHint: state.documentText?.slice(0, 1200),
    });

    const assessment =
      findings.length > 0
        ? scoreRiskFromFindings(provisionalFindings(findings))
        : assessDocumentRisk(
            {
              deadlines: state.facts?.deadlines || [],
              important_points: state.legal?.important_points || [],
              risks: state.risks || [],
              actions: state.actions || [],
            },
            state.documentText,
          );

    const next = pushAgentStep(
      { ...state, assessment },
      "score",
      {
        durationMs: Date.now() - started,
        generation: null,
        ok: true,
        note: `Score provisoire ${assessment.risk_score}/100 (${assessment.risk_level}).`,
      },
    );

    return {
      state: next,
      meta: {
        durationMs: Date.now() - started,
        ok: true,
        note: `Score ${assessment.risk_score}/100`,
      },
    };
  },
};
