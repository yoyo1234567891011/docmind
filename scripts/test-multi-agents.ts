/**
 * Smoke tests architecture multi-agents (sans LLM).
 */
import assert from "assert";

import {
  checkAnalysisCoherence,
  scoreAgent,
  verifyAgent,
  withAgentOverride,
  type AnalysisAgent,
  type AgentPipelineState,
} from "../src/ai/agents";
import { emptyTokens } from "../src/ai/agents/utils";
import { runMultiAgentAnalysis } from "../src/ai/agents/orchestrator";
import type { DocumentAnalysis, RiskFinding } from "../src/types";

const DOC = `
CONTRAT DE SERVICE
Entre Société Alpha SAS et Jean Dupont.
Le contrat est renouvelé par tacite reconduction pour un an,
sauf dénonciation trois mois avant le 31/12/2027.
Pénalité de 40 € en cas de retard.
`;

function baseState(partial: Partial<AgentPipelineState> = {}): AgentPipelineState {
  return {
    documentText: DOC,
    llmText: DOC,
    fileName: "contrat.pdf",
    model: "test",
    tokens: emptyTokens(),
    steps: [],
    classification: {
      category: "autre",
      label: "Contrat",
      confidence: 1,
    },
    ...partial,
  };
}

const stubClassify: AnalysisAgent = {
  id: "classify",
  label: "stub classify",
  kind: "deterministic",
  async run(state) {
    return {
      state: {
        ...state,
        classification: {
          category: "autre",
          label: "Contrat",
          confidence: 1,
        },
      },
      meta: { durationMs: 0, ok: true },
    };
  },
};

const stubFacts: AnalysisAgent = {
  id: "facts",
  label: "stub facts",
  kind: "deterministic",
  async run(state) {
    return {
      state: {
        ...state,
        facts: {
          date: "01/01/2026",
          dates: ["01/01/2026", "31/12/2027"],
          people: ["Jean Dupont"],
          organizations: ["Société Alpha SAS"],
          amounts: ["40 €"],
          deadlines: ["31/12/2027"],
          clauses: [
            "Le contrat est renouvelé par tacite reconduction pour un an",
          ],
        },
      },
      meta: { durationMs: 0, ok: true },
    };
  },
};

const stubLegal: AnalysisAgent = {
  id: "legal",
  label: "stub legal",
  kind: "deterministic",
  async run(state) {
    return {
      state: {
        ...state,
        legal: {
          document_type: "Contrat",
          title: "Contrat de service",
          summary: "Contrat avec reconduction tacite et pénalité.",
          important_points: ["Reconduction tacite", "Pénalité 40 €"],
        },
      },
      meta: { durationMs: 0, ok: true },
    };
  },
};

const stubRisks: AnalysisAgent = {
  id: "risks",
  label: "stub risks",
  kind: "deterministic",
  async run(state) {
    const findings: RiskFinding[] = [
      {
        description: "Renouvellement tacite",
        why: "Le contrat prévoit une reconduction automatique.",
        implication: "L'engagement se prolonge sans nouvelle signature.",
        consequence: "Le contrat continue faute de dénonciation.",
        mitigation: "Dénoncer par écrit trois mois avant l'échéance.",
        justification: "Le contrat prévoit une reconduction automatique.",
        impact: "L'engagement se prolonge sans nouvelle signature.",
        excerpt:
          "Le contrat est renouvelé par tacite reconduction pour un an",
        confidence: 0.9,
        severity: "eleve",
        criterion_id: "renouvellement_tacite",
        status: "ambiguous",
      },
      {
        description: "Pénalité retard",
        why: "Une pénalité forfaitaire est prévue en cas de retard.",
        implication: "Un coût supplémentaire s'ajoute à la dette.",
        consequence: "Le montant à régler augmente rapidement.",
        mitigation: "Payer avant l'échéance pour éviter la pénalité.",
        justification: "Une pénalité forfaitaire est prévue en cas de retard.",
        impact: "Un coût supplémentaire s'ajoute à la dette.",
        excerpt: "Pénalité de 40 € en cas de retard",
        confidence: 0.85,
        severity: "modere",
        criterion_id: "penalites",
        status: "ambiguous",
      },
    ];
    return {
      state: {
        ...state,
        risk_findings: findings,
        risks: findings.map((f) => f.description),
      },
      meta: { durationMs: 0, ok: true },
    };
  },
};

const stubActions: AnalysisAgent = {
  id: "actions",
  label: "stub actions",
  kind: "deterministic",
  async run(state) {
    return {
      state: {
        ...state,
        actions: [
          "Anticiper l'échéance : 31/12/2027",
          "Action orpheline sans lien",
        ],
      },
      meta: { durationMs: 0, ok: true },
    };
  },
};

async function testScoreAndVerify() {
  let state = baseState({
    facts: {
      date: "01/01/2026",
      dates: ["31/12/2027"],
      people: ["Jean Dupont"],
      organizations: ["Société Alpha SAS"],
      amounts: ["40 €"],
      deadlines: ["31/12/2027"],
      clauses: [],
    },
    legal: {
      document_type: "Contrat",
      title: "Contrat de service",
      summary: "Résumé test.",
      important_points: ["Point"],
    },
    risk_findings: [
      {
        description: "Renouvellement tacite",
        why: "Le contrat prévoit une reconduction automatique.",
        implication: "L'engagement se prolonge sans nouvelle signature.",
        consequence: "Le contrat continue faute de dénonciation.",
        mitigation: "Dénoncer par écrit trois mois avant l'échéance.",
        justification: "Le contrat prévoit une reconduction automatique.",
        impact: "L'engagement se prolonge sans nouvelle signature.",
        excerpt:
          "Le contrat est renouvelé par tacite reconduction pour un an",
        confidence: 0.9,
        severity: "eleve",
        criterion_id: "renouvellement_tacite",
        status: "ambiguous",
      },
    ],
    risks: ["Renouvellement tacite"],
    actions: [
      "Anticiper l'échéance : 31/12/2027",
      "Action orpheline sans lien",
    ],
  });

  state = (await scoreAgent.run(state)).state;
  assert.ok(state.assessment);
  assert.ok((state.assessment?.risk_score ?? 0) > 0);

  state = (await verifyAgent.run(state)).state;
  assert.ok(state.analysis);
  const analysis = state.analysis as DocumentAnalysis;
  assert.ok(
    analysis.risk_findings?.some((f) => f.status === "confirmed"),
    "finding avec extrait doit être confirmé",
  );
  assert.ok(
    !analysis.actions.some((a) => a.includes("orpheline")),
    "action orpheline droppée",
  );
  const issues = checkAnalysisCoherence(analysis);
  assert.equal(issues.length, 0, JSON.stringify(issues));
}

async function testOrchestratorStubs() {
  const agents = [
    stubClassify,
    stubFacts,
    stubLegal,
    stubRisks,
    scoreAgent,
    stubActions,
    verifyAgent,
  ];

  const result = await runMultiAgentAnalysis({
    documentText: DOC,
    fileName: "contrat.pdf",
    agents,
  });

  assert.equal(result.classification.label, "Contrat");
  assert.ok(result.analysis.title);
  assert.ok(result.analysis.risk_score > 0);
  assert.ok(
    result.analysis.risk_findings && result.analysis.risk_findings.length > 0,
  );
  assert.equal(checkAnalysisCoherence(result.analysis).length, 0);
}

async function testOverride() {
  const chain = withAgentOverride(stubClassify);
  assert.equal(chain[0]?.id, "classify");
  assert.equal(chain[0]?.label, "stub classify");
}

async function main() {
  await testScoreAndVerify();
  await testOrchestratorStubs();
  await testOverride();
  console.log("OK test-multi-agents");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
