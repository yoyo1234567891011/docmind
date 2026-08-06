/**
 * Tests unitaires raisonnement risques (verify + score pondéré).
 */
import assert from "assert";

import {
  excerptExistsInDocument,
  verifyAnalysisDraft,
} from "../src/ai/reasoning";
import { scoreRiskFromFindings } from "../src/services/risk/score-from-findings";
import type { RiskFinding } from "../src/types";

const DOC = `
CONTRAT DE PRESTATION
Le présent contrat est renouvelé par tacite reconduction pour une durée d'un an,
sauf dénonciation préalable trois mois avant l'échéance.
En cas de retard de paiement, une pénalité de 40 € est due.
Résiliation possible uniquement avec un préavis de 90 jours avant le 31/12/2027.
`;

function finding(partial: Partial<RiskFinding> & { description: string }): RiskFinding {
  const why =
    partial.why ??
    partial.justification ??
    "La clause figure explicitement dans le document.";
  const implication =
    partial.implication ??
    partial.impact ??
    "Elle crée un engagement contraignant pour les parties.";
  const consequence =
    partial.consequence ??
    "Un préjudice financier ou une perte de flexibilité peut survenir.";
  const mitigation =
    partial.mitigation ??
    "Relire la clause et négocier ou dénoncer dans les délais prévus.";
  return {
    description: partial.description,
    why,
    implication,
    consequence,
    mitigation,
    justification: why,
    impact: implication,
    excerpt: partial.excerpt ?? "",
    citation: partial.citation,
    confidence: partial.confidence ?? 0.8,
    severity: partial.severity ?? "eleve",
    criterion_id: partial.criterion_id,
    status: partial.status ?? "ambiguous",
    related_to: partial.related_to,
  };
}

function testExcerptMatch() {
  assert.equal(
    excerptExistsInDocument(
      "renouvelé par tacite reconduction pour une durée d'un an",
      DOC,
    ),
    true,
    "extrait présent doit matcher",
  );
  assert.equal(
    excerptExistsInDocument("clause inventée qui n'existe pas du tout ici", DOC),
    false,
    "extrait absent doit échouer",
  );
}

function testRejectMissingExcerpt() {
  const verified = verifyAnalysisDraft(
    {
      document_type: "Contrat",
      title: "T",
      summary: "S",
      date: "",
      dates: [],
      people: [],
      organizations: [],
      amounts: ["40 €"],
      deadlines: ["31/12/2027"],
      important_points: [],
      risks: ["Renouvellement tacite"],
      actions: ["Vérifier le préavis avant résiliation"],
      risk_findings: [
        finding({
          description: "Renouvellement tacite dangereux",
          excerpt: "",
          confidence: 0.9,
          criterion_id: "renouvellement_tacite",
        }),
      ],
    },
    DOC,
  );

  assert.equal(verified._verification.rejected, 1);
  assert.equal(verified.risk_findings.length, 0);
  assert.deepEqual(verified.risks, []);
}

function testConfirmAndScore() {
  const verified = verifyAnalysisDraft(
    {
      document_type: "Contrat",
      title: "T",
      summary: "S",
      date: "",
      dates: [],
      people: [],
      organizations: [],
      amounts: ["40 €"],
      deadlines: ["préavis de 90 jours avant le 31/12/2027"],
      important_points: [],
      risks: [],
      actions: [
        "Anticiper l'échéance : préavis de 90 jours avant le 31/12/2027",
        "Action orpheline sans lien",
      ],
      risk_findings: [
        finding({
          description: "Renouvellement par tacite reconduction",
          excerpt:
            "Le présent contrat est renouvelé par tacite reconduction pour une durée d'un an",
          confidence: 0.9,
          severity: "eleve",
          criterion_id: "renouvellement_tacite",
        }),
        finding({
          description: "Pénalité de retard",
          excerpt: "une pénalité de 40 € est due",
          confidence: 0.85,
          severity: "modere",
          criterion_id: "penalites",
        }),
        finding({
          description: "Risque flou",
          excerpt: "sauf dénonciation préalable trois mois avant l'échéance",
          confidence: 0.3,
          criterion_id: "resiliation",
        }),
      ],
    },
    DOC,
  );

  assert.equal(verified._verification.confirmed, 2);
  assert.equal(verified._verification.ambiguous, 1);
  assert.ok(
    verified.actions.every((a) => !a.includes("orpheline")),
    "action orpheline doit être droppée",
  );
  assert.equal(verified._verification.actions_dropped, 1);

  const score = scoreRiskFromFindings(verified.risk_findings);
  // renouvellement: 12 * 0.9 * 0.9 = 9.72 → 10
  // pénalités: 10 * 0.85 * 0.75 = 6.375 → 6
  assert.ok(score.risk_score >= 15 && score.risk_score <= 18, `score=${score.risk_score}`);
  assert.ok(
    score.risk_criteria.find((c) => c.id === "renouvellement_tacite")?.detected,
  );
  assert.ok(score.risk_criteria.find((c) => c.id === "penalites")?.detected);
  assert.equal(
    score.risk_criteria.find((c) => c.id === "resiliation")?.score,
    0,
    "ambigu exclu du score",
  );
}

function testWeightedSum() {
  const findings: RiskFinding[] = [
    finding({
      description: "A",
      excerpt: "x",
      confidence: 1,
      severity: "critique",
      criterion_id: "clauses_abusives",
      status: "confirmed",
    }),
    finding({
      description: "B",
      excerpt: "y",
      confidence: 1,
      severity: "critique",
      criterion_id: "sanctions",
      status: "confirmed",
    }),
  ];
  const score = scoreRiskFromFindings(findings);
  assert.equal(score.risk_score, 22); // 12 + 10
}

async function main() {
  testExcerptMatch();
  testRejectMissingExcerpt();
  testConfirmAndScore();
  testWeightedSum();
  console.log("OK test-reasoning-risks");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
