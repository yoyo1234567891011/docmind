import { RISK_CRITERIA } from "@/services/risk/criteria";
import type {
  RiskAssessment,
  RiskCriterionId,
  RiskCriterionResult,
  RiskFinding,
  RiskSeverity,
} from "@/types";

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

function severityFactor(severity: RiskSeverity): number {
  switch (severity) {
    case "critique":
      return 1;
    case "eleve":
      return 0.9;
    case "modere":
      return 0.75;
    default:
      return 0.55;
  }
}

/**
 * Score pondéré à partir des findings confirmés (pas de regex).
 * Points critère = maxScore × confidence × facteur gravité (meilleur finding).
 */
export function scoreRiskFromFindings(
  findings: RiskFinding[],
): RiskAssessment {
  const confirmed = findings.filter((f) => f.status === "confirmed");

  const byCriterion = new Map<
    RiskCriterionId,
    { score: number; reasons: string[] }
  >();

  for (const finding of confirmed) {
    const id = finding.criterion_id;
    if (!id) continue;
    const def = RISK_CRITERIA.find((c) => c.id === id);
    if (!def) continue;

    const points = Math.min(
      def.maxScore,
      def.maxScore *
        Math.min(1, Math.max(0, finding.confidence)) *
        severityFactor(finding.severity),
    );

    const prev = byCriterion.get(id);
    const reason =
      finding.citation?.excerpt.trim() ||
      finding.excerpt.trim() ||
      finding.justification.trim();
    if (!prev || points > prev.score) {
      byCriterion.set(id, {
        score: points,
        reasons: reason ? [reason.slice(0, 200)] : prev?.reasons ?? [],
      });
    } else if (reason && prev.reasons.length < 3) {
      prev.reasons.push(reason.slice(0, 200));
    }
  }

  const risk_criteria: RiskCriterionResult[] = RISK_CRITERIA.map((criterion) => {
    const hit = byCriterion.get(criterion.id);
    const score = hit ? clampScore(hit.score) : 0;
    return {
      id: criterion.id,
      label: criterion.label,
      detected: score > 0,
      score,
      max_score: criterion.maxScore,
      reasons: hit?.reasons ?? [],
    };
  });

  const risk_score = clampScore(
    risk_criteria.reduce((total, item) => total + item.score, 0),
  );
  const risk_level = getRiskLevel(risk_score);

  const detected = risk_criteria.filter((c) => c.detected);
  const lines = [
    `Score de risque pondéré : ${risk_score}/100 (niveau ${getRiskLevelLabel(risk_level)}).`,
    "",
    "Calcul à partir de critères justifiés par des extraits du document (pas de simple mot-clé) :",
    ...RISK_CRITERIA.map((c) => `- ${c.label} (max ${c.maxScore})`),
    "",
  ];

  if (detected.length === 0) {
    lines.push(
      "Aucun critère confirmé avec preuve exploitable. Score bas.",
    );
  } else {
    lines.push("Critères retenus et contribution :");
    for (const item of detected) {
      const evidence =
        item.reasons.length > 0
          ? ` Preuve(s) : ${item.reasons.map((r) => `"${r}"`).join(" ; ")}`
          : "";
      lines.push(
        `- ${item.label} : +${item.score}/${item.max_score}.${evidence}`,
      );
    }
    lines.push("");
    lines.push(
      `Total : ${detected.map((d) => d.score).join(" + ")} = ${risk_score}/100.`,
    );
  }

  const ambiguous = findings.filter((f) => f.status === "ambiguous").length;
  if (ambiguous > 0) {
    lines.push("");
    lines.push(
      `${ambiguous} risque(s) ambigu(s) exclus du score (confiance insuffisante ou preuve partielle).`,
    );
  }

  return {
    risk_score,
    risk_level,
    risk_explanation: lines.join("\n"),
    risk_criteria,
  };
}
