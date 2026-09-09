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
        severity: "eleve",
        criterion_id: "penalites",
        related_to: "",
      },
    ],
    risks: [] as string[],
  });

  const ids = RISK_CRITERION_IDS.join(", ");
  const category = input.classification.category;
  const priorityLine =
    category === "bail"
      ? "PRIORITÉ bail: loyer, charges, dépôt de garantie, durée, tacite reconduction (si écrite), préavis, clause résolutoire, honoraires, révision IRL — pas un délai générique seul."
      : category === "assurance"
        ? "PRIORITÉ assurance: tacite reconduction (si écrite), franchise, cotisation, carence, exclusions, frais/pénalités de résiliation."
        : category === "impots"
          ? "PRIORITÉ impôts/taxe: montant dû ou à prélever, date de prélèvement / limite de paiement / opposition, majoration — jamais totaux nationaux."
          : /mise\s+en\s+demeure|recouvrement/i.test(input.legal.document_type || "")
            ? "PRIORITÉ: frais/pénalités/montants réclamés, délais courts, huissier/poursuites, obligations du destinataire."
            : "PRIORITÉ: montants et engagements concrets du destinataire, délais actionnables, clauses de reconduction/résiliation écrites — éviter les généralités.";

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
    "FACTUEL: jamais de risque sans excerpt recopié mot à mot du DOCUMENT. N’invente ni clause, ni montant, ni délai.",
    "Chaque risque DOIT avoir: why, implication, consequence, mitigation (phrases courtes, concrètes).",
    "why = pourquoi il existe. implication = ce qu'il implique. consequence = ce qui peut arriver. mitigation = comment le réduire.",
    priorityLine,
    "INTERDIT d'attribuer renouvellement_tacite sans excerpt contenant reconduction/renouvellement tacite.",
    "INTERDIT les titres vagues (« obligation de payer », « délai 30 jours ») s’il existe un fait chiffré ou daté dans le DOCUMENT.",
    "Pas de risque basé sur un seul mot-clé. Si doute → confidence < 0.55. Omettre plutôt qu’inventer.",
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
