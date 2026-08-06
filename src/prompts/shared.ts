import { getLegalChecklistLabels } from "@/ai/scoring";
import { RISK_CRITERION_IDS } from "@/types";
import {
  applyPromptTemplate,
  getActivePromptTemplateSync,
} from "@/services/admin/runtime";

/** Schéma compact — findings structurés + listes compat. */
const ANALYSIS_OUTPUT_EXAMPLE = JSON.stringify({
  document_type: "",
  title: "",
  summary: "",
  date: "",
  dates: [],
  people: [],
  organizations: [],
  amounts: [],
  deadlines: [],
  important_points: [],
  risks: [],
  actions: [],
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
  _reasoning: "",
  _self_check: { contradicted: [] as string[] },
});

export interface SpecializedPromptInput {
  categoryLabel: string;
  focusPoints: string[];
  documentText: string;
}

/**
 * Prompt d'analyse : raisonnement avec preuves (extraits) + JSON compact.
 */
export function buildSpecializedAnalysisPrompt({
  categoryLabel,
  focusPoints,
  documentText,
}: SpecializedPromptInput): string {
  const focusList = focusPoints
    .slice(0, 5)
    .map((point) => `- ${point}`)
    .join("\n");
  const checklist = getLegalChecklistLabels().join(", ");
  const criterionIds = RISK_CRITERION_IDS.join(", ");
  const vars = {
    categoryLabel,
    focusList,
    checklist,
    schema: ANALYSIS_OUTPUT_EXAMPLE,
    documentText: documentText.trim(),
  };

  const override = getActivePromptTemplateSync("analysis");
  if (override) {
    return applyPromptTemplate(override, vars);
  }

  return [
    `Juriste FR — analyse "${categoryLabel}". JSON uniquement, aucune prose.`,
    "Raisonne avant de conclure. Pas de risque basé sur un seul mot-clé isolé.",
    "RÈGLE: jamais de conclusion sans excerpt recopié mot à mot du document.",
    "Chaque risque DOIT avoir: why, implication, consequence, mitigation + excerpt + confidence.",
    "why=pourquoi il existe; implication=ce qu'il implique; consequence=ce qui peut arriver; mitigation=comment le réduire.",
    "Si doute / extrait flou → confidence < 0.55. severity: faible|modere|eleve|critique.",
    `criterion_id parmi: ${criterionIds}.`,
    "risks[] = libellés courts des risques retenus. actions[] = diligences liées à un risque ou une échéance réelle.",
    "deadlines = dates/délais réellement présents. N'invente rien. Max 5 items/tableau (hors risk_findings max 8).",
    `_reasoning = 2-4 phrases de raisonnement interne. _self_check.contradicted = libellés à rejeter.`,
    `Focus: ${focusList.replace(/\n/g, " | ")}`,
    `Checklist: ${checklist}.`,
    `Schéma: ${ANALYSIS_OUTPUT_EXAMPLE}`,
    "summary: 2 phrases orientées enjeux. title: objet du document.",
    "<<<DOCUMENT>>>",
    documentText.trim(),
    "<<<FIN>>>",
  ].join("\n");
}
