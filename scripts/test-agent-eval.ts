/**
 * Tests scoring par agent (sans LLM / sans serveur).
 */
import assert from "assert";
import { mkdir, readFile } from "fs/promises";
import os from "os";
import path from "path";

import {
  averageAgentScore,
  scoreAgents,
  writeAgentHtmlReport,
} from "../src/ai/evaluator";
import type { DocumentEvalResult, FieldComparison } from "../src/types/eval";
import type { DocumentAnalysis } from "../src/types";
import { RISK_CRITERIA } from "../src/services/risk/criteria";

function field(
  name: FieldComparison["field"],
  score: number,
): FieldComparison {
  const status =
    score >= 0.85 ? "correct" : score >= 0.45 ? "partial" : "error";
  return {
    field: name,
    status,
    score,
    expected: "",
    predicted: "",
    correctItems: [],
    errors: [],
    omissions: [],
    detail: `${name}=${score}`,
  };
}

function analysis(): DocumentAnalysis {
  const risk_criteria = RISK_CRITERIA.map((c) => ({
    id: c.id,
    label: c.label,
    detected: c.id === "penalites",
    score: c.id === "penalites" ? 8 : 0,
    max_score: c.maxScore,
    reasons: c.id === "penalites" ? ["pénalité"] : [],
  }));

  return {
    document_type: "Relance",
    title: "Relance test",
    summary: "Résumé test.",
    date: "01/01/2026",
    dates: ["01/01/2026"],
    people: ["Alice"],
    organizations: ["Org"],
    amounts: ["100 €"],
    deadlines: ["31/12/2026"],
    important_points: ["Point"],
    risks: ["Pénalité de retard"],
    actions: ["Anticiper l'échéance : 31/12/2026"],
    risk_score: 8,
    risk_level: "faible",
    risk_explanation: "test",
    risk_criteria,
    risk_findings: [
      {
        description: "Pénalité de retard",
        why: "Le document prévoit une pénalité en cas de retard de paiement.",
        implication: "Une somme forfaitaire s'ajoute à la créance.",
        consequence: "Le montant dû augmente rapidement.",
        mitigation: "Payer avant l'échéance ou contester par écrit sous délai.",
        justification: "Le document prévoit une pénalité en cas de retard de paiement.",
        impact: "Une somme forfaitaire s'ajoute à la créance.",
        excerpt: "une pénalité de retard de 40 euros est prévue",
        citation: {
          page: 1,
          paragraph: 2,
          excerpt: "une pénalité de retard de 40 euros est prévue",
        },
        confidence: 0.9,
        severity: "modere",
        criterion_id: "penalites",
        status: "confirmed",
      },
    ],
  };
}

async function main() {
  const fields: FieldComparison[] = [
    field("document_type", 1),
    field("title", 0.5),
    field("summary", 0.9),
    field("people", 1),
    field("organizations", 0.8),
    field("amounts", 0.7),
    field("dates", 1),
    field("deadlines", 0.6),
    field("important_points", 0.4),
    field("risks", 0.75),
    field("actions", 0.55),
    field("risk_score", 0.95),
  ];

  const agents = scoreAgents({
    fields,
    analysis: analysis(),
    classification: {
      category: "autre",
      label: "Relance",
      confidence: 0.9,
    },
  });

  assert.equal(agents.length, 7);
  assert.equal(agents.find((a) => a.id === "classify")?.score, 1);
  assert.ok((agents.find((a) => a.id === "facts")?.score ?? 0) > 0.7);
  assert.ok((agents.find((a) => a.id === "verify")?.score ?? 0) >= 0.7);
  assert.ok(averageAgentScore(agents) > 0.5);

  const tmp = path.join(os.tmpdir(), `docmind-agent-eval-${Date.now()}.html`);
  const result: DocumentEvalResult = {
    id: "t1",
    relativePath: "x/y.pdf",
    category: "x",
    fileName: "y.pdf",
    expectedPath: "x/y_expected.json",
    success: true,
    score: 0.7,
    fields,
    agents,
    agentScore: averageAgentScore(agents),
    durationMs: 1200,
  };

  await mkdir(path.dirname(tmp), { recursive: true });
  await writeAgentHtmlReport([result], tmp);
  const html = await readFile(tmp, "utf8");
  assert.ok(html.includes("Classification"));
  assert.ok(html.includes("Extraction"));
  assert.ok(html.includes("Vérification finale"));
  assert.ok(html.includes("Évaluation par agent"));

  console.log("OK test-agent-eval");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
