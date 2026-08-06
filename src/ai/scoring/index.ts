/**
 * Risk scoring (deterministic). Change weights/patterns in `src/services/risk`.
 */
import { RISK_CRITERIA } from "@/services/risk/criteria";

export { RISK_CRITERIA } from "@/services/risk/criteria";
export type { RiskCriterionDefinition } from "@/services/risk/criteria";
export { assessDocumentRisk, buildLegalRiskFindings } from "@/services/risk/score";
export { scoreRiskFromFindings } from "@/services/risk/score-from-findings";
export { detectRiskCriterion } from "@/services/risk/detect";

/** Labels for analysis prompts — kept in sync with scoring criteria. */
export function getLegalChecklistLabels(): string[] {
  return RISK_CRITERIA.map((criterion) => criterion.label);
}
