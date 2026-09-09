import type { RiskFinding } from "@/types";
import type { ExtractedFacts } from "@/ai/agents/types";
import { truncateAtTextBoundary } from "@/ai/post-processing/display-cleanup";

export function buildActionsAgentPrompt(input: {
  facts: ExtractedFacts;
  risks: string[];
  findings: RiskFinding[];
  documentText: string;
}): string {
  const schema = JSON.stringify({
    actions: [] as string[],
  });

  const ctx = JSON.stringify({
    deadlines: input.facts.deadlines.slice(0, 5),
    risks: input.risks.slice(0, 6),
    findings: input.findings.slice(0, 6).map((f) => ({
      description: f.description,
      severity: f.severity,
      related_to: f.related_to,
      excerpt: truncateAtTextBoundary(f.excerpt || "", 120),
    })),
  });

  return [
    "Agent actions recommandées. JSON uniquement.",
    "Propose 1 à 5 diligences concrètes liées aux risques ou échéances fournis.",
    "Chaque action doit mentionner clairement le risque ou l'échéance concerné.",
    "Pas d'action générique sans lien (« vérifier le document », « lire attentivement »). N'invente pas de dates, montants ou délais absents du contexte/DOCUMENT.",
    "Chaque action doit être une phrase complète (jamais coupée en milieu de mot).",
    `Contexte: ${ctx}`,
    `Schéma: ${schema}`,
    "<<<DOCUMENT>>>",
    truncateAtTextBoundary(input.documentText.trim(), 4000),
    "<<<FIN>>>",
  ].join("\n");
}
