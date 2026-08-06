import { scoreRiskFromFindings } from "@/services/risk/score-from-findings";
import type { DocumentAnalysis, RiskFinding } from "@/types";
import type { VerifiedAnalysisDraft } from "@/ai/reasoning/verify-analysis";

/**
 * Projette un brouillon vérifié vers DocumentAnalysis (compat JSON app).
 * Strippe les champs internes (_verification, _reasoning, …).
 */
export function projectVerifiedAnalysis(
  verified: VerifiedAnalysisDraft,
): DocumentAnalysis {
  const findings: RiskFinding[] = verified.risk_findings ?? [];
  const assessment = scoreRiskFromFindings(findings);

  return {
    document_type: verified.document_type,
    title: verified.title,
    summary: verified.summary,
    date: verified.date,
    dates: verified.dates,
    people: verified.people,
    organizations: verified.organizations,
    amounts: verified.amounts,
    deadlines: verified.deadlines,
    important_points: verified.important_points,
    important_point_findings: verified.important_point_findings,
    risks: verified.risks,
    actions: verified.actions,
    risk_findings: findings,
    ...assessment,
  };
}
