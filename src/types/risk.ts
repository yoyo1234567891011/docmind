import type { DocumentCitation } from "@/types/citation";

export const RISK_CRITERION_IDS = [
  "renouvellement_tacite",
  "frais_caches",
  "penalites",
  "clauses_abusives",
  "obligations_importantes",
  "delais",
  "resiliation",
  "augmentation_tarif",
  "engagement",
  "sanctions",
] as const;

export type RiskCriterionId = (typeof RISK_CRITERION_IDS)[number];

export type RiskSeverity = "faible" | "modere" | "eleve" | "critique";

export type RiskFindingStatus = "confirmed" | "ambiguous" | "rejected";

/**
 * Risque structuré — citation obligatoire + 4 explications métier.
 */
export interface RiskFinding {
  description: string;
  /** Pourquoi le risque existe */
  why: string;
  /** Ce qu'il implique */
  implication: string;
  /** Ce qui peut arriver */
  consequence: string;
  /** Comment le réduire */
  mitigation: string;
  /** @deprecated alias de why */
  justification: string;
  /** @deprecated alias de implication */
  impact: string;
  /** Miroir de citation.excerpt (compat) */
  excerpt: string;
  /** Preuve obligatoire (page, paragraphe, extrait) */
  citation?: DocumentCitation;
  /** 0..1 */
  confidence: number;
  severity: RiskSeverity;
  criterion_id?: RiskCriterionId;
  status: RiskFindingStatus;
  related_to?: string;
}

export interface RiskCriterionResult {
  id: RiskCriterionId;
  label: string;
  detected: boolean;
  score: number;
  max_score: number;
  reasons: string[];
}

export interface RiskAssessment {
  risk_score: number;
  risk_level: "faible" | "modere" | "eleve" | "critique";
  risk_explanation: string;
  risk_criteria: RiskCriterionResult[];
}

export function isRiskCriterionId(value: string): value is RiskCriterionId {
  return (RISK_CRITERION_IDS as readonly string[]).includes(value);
}

export function isRiskSeverity(value: string): value is RiskSeverity {
  return (
    value === "faible" ||
    value === "modere" ||
    value === "eleve" ||
    value === "critique"
  );
}

function pickStr(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** Normalise les 4 champs d'explication (+ alias legacy). */
export function normalizeRiskExplanations(raw: Record<string, unknown>): {
  why: string;
  implication: string;
  consequence: string;
  mitigation: string;
  justification: string;
  impact: string;
} {
  const why = pickStr(
    raw.why,
    raw.justification,
    raw.pourquoi,
    raw.reason,
  );
  const implication = pickStr(
    raw.implication,
    raw.impact,
    raw.implique,
    raw.implies,
  );
  const consequence = pickStr(
    raw.consequence,
    raw.what_can_happen,
    raw.peut_arriver,
    raw.outcome,
  );
  const mitigation = pickStr(
    raw.mitigation,
    raw.how_to_reduce,
    raw.reduire,
    raw.reduction,
  );
  return {
    why,
    implication,
    consequence,
    mitigation,
    justification: why,
    impact: implication,
  };
}

/** True si les 4 champs d'explication sont renseignés. */
export function hasRiskExplanations(
  finding: Pick<
    RiskFinding,
    | "why"
    | "implication"
    | "consequence"
    | "mitigation"
    | "justification"
    | "impact"
  >,
): boolean {
  const why = finding.why || finding.justification;
  const implication = finding.implication || finding.impact;
  return (
    why.trim().length >= 8 &&
    implication.trim().length >= 8 &&
    finding.consequence.trim().length >= 8 &&
    finding.mitigation.trim().length >= 8
  );
}
