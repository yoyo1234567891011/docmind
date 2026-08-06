import type { DocumentClassification } from "@/types";
import type { ExtractedFacts } from "@/ai/agents/types";

export function buildLegalAgentPrompt(input: {
  classification: DocumentClassification;
  facts: ExtractedFacts;
  documentText: string;
  knowledgeBlock?: string;
}): string {
  const schema = JSON.stringify({
    document_type: "",
    title: "",
    summary: "",
    important_points: [
      {
        statement: "",
        excerpt: "",
      },
    ],
  });

  const factsBrief = JSON.stringify({
    date: input.facts.date,
    amounts: input.facts.amounts.slice(0, 4),
    deadlines: input.facts.deadlines.slice(0, 4),
    clauses: input.facts.clauses.slice(0, 4),
    people: input.facts.people.slice(0, 4),
    organizations: input.facts.organizations.slice(0, 4),
  });

  return [
    `Agent analyse juridique FR — document type "${input.classification.label}". JSON uniquement.`,
    "Consulte les CONNAISSANCES_JURIDIQUES avant d'analyser ; conclusions uniquement avec extrait du DOCUMENT.",
    "Produis title, summary (2 phrases enjeux), document_type.",
    "important_points = [{statement, excerpt}] — excerpt recopié mot à mot. Sans preuve → n'inclus pas le point.",
    "Base-toi sur le document et les faits fournis. Pas de liste de risques ici.",
    `Faits déjà extraits: ${factsBrief}`,
    `Schéma: ${schema}`,
    input.knowledgeBlock?.trim() || "",
    "<<<DOCUMENT>>>",
    input.documentText.trim(),
    "<<<FIN>>>",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
