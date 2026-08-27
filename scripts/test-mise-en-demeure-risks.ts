import assert from "node:assert/strict";
import { enrichAnalysisDetailed } from "../src/ai/post-processing/enrich";
import { mergeWithLocalRiskFindings } from "../src/ai/post-processing/inject-local-risk-findings";
import { verifyAnalysisDraft } from "../src/ai/reasoning/verify-analysis";
import { scoreRiskFromFindings } from "../src/services/risk/score-from-findings";
import type { RiskFinding } from "../src/types";

const DOC = `
MISE EN DEMEURE
Madame, Monsieur,
Nous vous mettons en demeure de payer la somme totale de 274 € sous 8 jours.
Cette somme comprend le principal, une pénalité de retard de 40 € et des frais de recouvrement de 23 €.
À défaut de paiement, nous confierons le dossier à un huissier de justice.
Vous disposez d'un délai de 10 jours pour contester cette créance.
`;

function baseFinding(
  partial: Partial<RiskFinding> & { description: string },
): RiskFinding {
  const why = partial.why ?? "La clause figure explicitement dans le document.";
  const implication =
    partial.implication ?? "Elle crée une contrainte pour le destinataire.";
  const consequence =
    partial.consequence ?? "Un préjudice financier ou procédural peut survenir.";
  const mitigation =
    partial.mitigation ?? "Vérifier le fondement et répondre dans les délais.";
  return {
    description: partial.description,
    why,
    implication,
    consequence,
    mitigation,
    justification: why,
    impact: implication,
    excerpt: partial.excerpt ?? "",
    confidence: partial.confidence ?? 0.9,
    severity: partial.severity ?? "eleve",
    criterion_id: partial.criterion_id,
    status: partial.status ?? "ambiguous",
  };
}

// Simule le chemin live verifyAgent (merge → verify → score)
const merged = mergeWithLocalRiskFindings(
  [
    baseFinding({
      description: "Reconduction tacite",
      excerpt: "pénalité de retard de 40 €",
      criterion_id: "renouvellement_tacite",
    }),
  ],
  DOC,
);
const verified = verifyAnalysisDraft(
  {
    document_type: "Mise en demeure",
    title: "MED",
    summary: "Créance.",
    date: "",
    dates: [],
    people: [],
    organizations: [],
    amounts: ["274 €", "40 €", "23 €"],
    deadlines: ["sous 8 jours"],
    important_points: ["Pénalité 40 €", "Frais 23 €", "Total 274 €"],
    risks: [],
    actions: [],
    risk_findings: merged,
  },
  DOC,
);
const findings = verified.risk_findings ?? [];
const confirmed = findings.filter((f) => f.status === "confirmed");
const assessment = scoreRiskFromFindings(findings);

assert.ok(assessment.risk_score > 0, `score > 0, got ${assessment.risk_score}`);
assert.ok(
  confirmed.some((f) => /P[ée]nalit/i.test(f.description)),
  "penalties title",
);
assert.ok(
  confirmed.some((f) => /Frais de recouvrement/i.test(f.description)),
  "fees title",
);
assert.ok(
  confirmed.some((f) => /Total r[ée]clam/i.test(f.description)),
  "total title",
);
assert.ok(
  confirmed.some((f) => /D[ée]lai tr[èe]s court/i.test(f.description)),
  "deadline title",
);
assert.ok(
  confirmed.some((f) => /huissier/i.test(f.description)),
  "bailiff title",
);
assert.ok(
  confirmed.some((f) => /contester/i.test(f.description)),
  "contest title",
);
assert.ok(
  !confirmed.some((f) => f.criterion_id === "renouvellement_tacite"),
  "no false renew",
);

const enriched = enrichAnalysisDetailed(
  {
    document_type: "Mise en demeure",
    title: "MED",
    summary: "Créance.",
    date: "",
    dates: [],
    people: [],
    organizations: [],
    amounts: ["274 €", "40 €", "23 €"],
    deadlines: ["sous 8 jours"],
    important_points: [],
    risks: [],
    actions: [],
    risk_findings: [],
  },
  DOC,
  { category: "autre", label: "Mise en demeure", confidence: 0.9 },
);
assert.ok(
  enriched.analysis.risk_score > 0,
  `enrich score > 0, got ${enriched.analysis.risk_score}`,
);

console.log(
  JSON.stringify(
    {
      score: assessment.risk_score,
      level: assessment.risk_level,
      watch: confirmed.map((f) => f.description),
    },
    null,
    2,
  ),
);
console.log("OK mise-en-demeure watch+score mapping");
