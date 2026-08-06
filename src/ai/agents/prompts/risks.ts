import { RISK_CRITERION_IDS } from "@/types";
import type { DocumentClassification } from "@/types";
import type { ExtractedFacts } from "@/ai/agents/types";
import type { LegalAnalysis } from "@/ai/agents/types";

export function buildRisksAgentPrompt(input: {
  classification: DocumentClassification;
  facts: ExtractedFacts;
  legal: LegalAnalysis;
  documentText: string;
  knowledgeBlock?: string;
}): string {
  const schema = JSON.stringify({
    risk_findings: [
      {
        description: "",
        why: "",
        implication: "",
        consequence: "",
        mitigation: "",
        excerpt: "",
        confidence: 0.8,
        severity: "modere",
        criterion_id: "renouvellement_tacite",
        related_to: "",
      },
    ],
    risks: [] as string[],
  });

  const ids = RISK_CRITERION_IDS.join(", ");
  const context = JSON.stringify({
    title: input.legal.title,
    summary: input.legal.summary,
    important_points: input.legal.important_points.slice(0, 5),
    clauses: input.facts.clauses.slice(0, 5),
    deadlines: input.facts.deadlines.slice(0, 4),
  });

  return [
    "Agent évaluation des risques juridiques. JSON uniquement.",
    "Consulte les CONNAISSANCES_JURIDIQUES (risques fréquents, pièges, critères) avant de conclure.",
    "RÈGLE: jamais de risque sans excerpt recopié mot à mot du DOCUMENT.",
    "Chaque risque DOIT avoir: why, implication, consequence, mitigation (phrases courtes, concrètes).",
    "why = pourquoi il existe. implication = ce qu'il implique. consequence = ce qui peut arriver. mitigation = comment le réduire.",
    "Pas de risque basé sur un seul mot-clé. Si doute → confidence < 0.55.",
    `criterion_id parmi: ${ids}. severity: faible|modere|eleve|critique.`,
    "risks[] = libellés courts. Max 6 findings.",
    `Contexte: ${context}`,
    `Schéma: ${schema}`,
    input.knowledgeBlock?.trim() || "",
    "<<<DOCUMENT>>>",
    input.documentText.trim(),
    "<<<FIN>>>",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
