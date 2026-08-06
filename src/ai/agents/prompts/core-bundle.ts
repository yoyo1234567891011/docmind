import { RISK_CRITERION_IDS } from "@/types";
import type { ExtractedFacts } from "../types";

/**
 * Bundle LLM Local First : le modèle ne produit que l'analyse qualitative.
 * Faits structurés (dates, montants, personnes, orgs, échéances) = extraction locale.
 */
export function buildCoreBundlePrompt(input: {
  categoryLabel: string;
  documentText: string;
  knowledgeBlock?: string;
  localFacts?: ExtractedFacts;
}): string {
  const ids = RISK_CRITERION_IDS.join(",");
  const schema = JSON.stringify({
    document_type: "",
    title: "",
    summary: "",
    important_points: [{ statement: "", excerpt: "" }],
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
    actions: [] as string[],
  });

  const factsHint = input.localFacts
    ? `FAITS_LOCAUX (ne pas recalculer ni renvoyer — fournis par le serveur): ${JSON.stringify({
        date: input.localFacts.date,
        dates: input.localFacts.dates,
        people: input.localFacts.people,
        organizations: input.localFacts.organizations,
        amounts: input.localFacts.amounts,
        deadlines: input.localFacts.deadlines,
      })}`
    : "";

  return [
    `Juriste FR — "${input.categoryLabel}". JSON uniquement.`,
    "Local First: dates/montants/personnes/organisations/échéances déjà extraits localement — ne les génère pas.",
    "Tu produis uniquement: résumé, analyse (title/document_type/important_points), risques (risk_findings + risks), recommandations (actions), justification (why/implication/consequence/mitigation).",
    "Preuve obligatoire: chaque risque/point = excerpt recopié mot à mot. Risque sans why+implication+consequence+mitigation+excerpt → omettre.",
    "Consulte CONNAISSANCES_JURIDIQUES pour qualifier/contrôler; ancre toute conclusion dans le DOCUMENT (marqueurs <<<PAGE n>>>).",
    "1 passe. N'invente rien. Max 5 items/liste (findings ≤6).",
    `[ANALYSE] document_type,title,summary(2 phrases),important_points[{statement,excerpt}] | [RISQUES] description+why+implication+consequence+mitigation+excerpt+confidence0..1; pas 1 mot-clé; doute→confidence<0.55; criterion_id:${ids}; severity:faible|modere|eleve|critique; risks[]=libellés courts cités | [ACTIONS] diligences concrètes.`,
    factsHint,
    `Schéma:${schema}`,
    input.knowledgeBlock?.trim() || "",
    "<<<DOCUMENT>>>",
    input.documentText.trim(),
    "<<<FIN>>>",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
