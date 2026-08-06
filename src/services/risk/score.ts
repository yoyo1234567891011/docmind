import { RISK_CRITERIA } from "@/services/risk/criteria";
import { buildRiskCorpus, detectRiskCriterion } from "@/services/risk/detect";
import type { DocumentAnalysis, RiskAssessment, RiskCriterionResult } from "@/types";

function clampScore(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function getRiskLevel(score: number): RiskAssessment["risk_level"] {
  if (score >= 75) return "critique";
  if (score >= 50) return "eleve";
  if (score >= 25) return "modere";
  return "faible";
}

function getRiskLevelLabel(level: RiskAssessment["risk_level"]): string {
  switch (level) {
    case "critique":
      return "critique";
    case "eleve":
      return "élevé";
    case "modere":
      return "modéré";
    default:
      return "faible";
  }
}

function buildExplanation(
  score: number,
  level: RiskAssessment["risk_level"],
  criteria: RiskCriterionResult[],
): string {
  const detected = criteria.filter((item) => item.detected);
  const notDetected = criteria.filter((item) => !item.detected);

  const lines = [
    `Score de risque attribué : ${score}/100 (niveau ${getRiskLevelLabel(level)}).`,
    "",
    "Analyse juridique sur 10 critères obligatoires (total 100 points) :",
    ...RISK_CRITERIA.map(
      (criterion) => `- ${criterion.label} (${criterion.maxScore})`,
    ),
    "",
  ];

  if (detected.length === 0) {
    lines.push(
      "Aucun critère juridique n'a été détecté dans le document. Le score reste donc bas.",
    );
    return lines.join("\n");
  }

  lines.push("Critères détectés et contribution au score :");

  for (const item of detected) {
    const evidence =
      item.reasons.length > 0
        ? ` Preuve(s) : ${item.reasons.map((reason) => `"${reason}"`).join(" ; ")}`
        : "";
    lines.push(
      `- ${item.label} : +${item.score}/${item.max_score}.${evidence}`,
    );
  }

  if (notDetected.length > 0) {
    lines.push("");
    lines.push(
      `Critères non détectés (0 point) : ${notDetected
        .map((item) => item.label)
        .join(", ")}.`,
    );
  }

  lines.push("");
  lines.push(
    `Total retenu : ${detected
      .map((item) => item.score)
      .join(" + ")} = ${score}/100.`,
  );

  return lines.join("\n");
}

/**
 * Turns detected legal criteria into explicit risk bullets for the UI.
 */
export function buildLegalRiskFindings(
  criteria: RiskCriterionResult[],
): string[] {
  return criteria
    .filter((item) => item.detected)
    .map((item) => {
      const evidence = item.reasons[0]?.trim();
      return evidence
        ? `[${item.label}] ${evidence}`
        : `[${item.label}] Mention détectée dans le document`;
    });
}

export function assessDocumentRisk(
  analysis: Pick<
    DocumentAnalysis,
    "risks" | "important_points" | "deadlines" | "actions"
  >,
  documentText: string,
): RiskAssessment {
  const corpus = buildRiskCorpus({
    documentText,
    risks: analysis.risks,
    importantPoints: analysis.important_points,
    deadlines: analysis.deadlines,
    actions: analysis.actions,
  });

  const risk_criteria = RISK_CRITERIA.map((criterion) =>
    detectRiskCriterion(criterion, corpus),
  );

  const risk_score = clampScore(
    risk_criteria.reduce((total, item) => total + item.score, 0),
  );
  const risk_level = getRiskLevel(risk_score);
  const risk_explanation = buildExplanation(
    risk_score,
    risk_level,
    risk_criteria,
  );

  return {
    risk_score,
    risk_level,
    risk_explanation,
    risk_criteria,
  };
}
