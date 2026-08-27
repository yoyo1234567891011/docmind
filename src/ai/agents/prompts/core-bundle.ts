import { RISK_CRITERION_IDS } from "@/types";
import type { ExtractedFacts } from "../types";

/** Hint compact — seulement signaux non évidents dans l'extrait document. */
function compactLocalFactsHint(facts: ExtractedFacts): string {
  const parts: string[] = [];
  if (facts.amounts?.length) {
    parts.push(`€:${facts.amounts.slice(0, 6).join("|")}`);
  }
  if (facts.deadlines?.length) {
    parts.push(`éch:${facts.deadlines.slice(0, 4).join("|")}`);
  }
  if (facts.date && !facts.deadlines?.includes(facts.date)) {
    parts.push(`date:${facts.date}`);
  }
  return parts.join(" ") || "";
}

function categoryPriorityHint(categoryLabel: string): string {
  const s = categoryLabel.toLowerCase();
  if (s.includes("bail") || s.includes("location")) {
    return "Focus watch: loyer €, charges, dépôt, durée, tacite, préavis, clause résolutoire. Titres chiffrés.";
  }
  if (s.includes("prêt") || s.includes("pret")) {
    return "Focus watch: capital, TAEG, mensualité, durée, frais dossier (secondaires), rétractation.";
  }
  if (s.includes("banque") || s.includes("relev")) {
    return "Focus watch: frais/commissions €, intérêts débiteurs, rejet, découvert, FICP/suspension, date régularisation. PAS de résiliation/abonnement.";
  }
  if (s.includes("impôt") || s.includes("impot") || s.includes("taxe")) {
    return "Focus watch: montant à prélever/payer €, date limite, opposition, majoration %. Pas de stats nationales.";
  }
  if (s.includes("mise en demeure") || s === "med" || s.includes("recouvrement")) {
    return "Focus watch: total dû €, pénalités, frais recouvrement, délai 8/10 j, huissier, contestation.";
  }
  if (s.includes("assurance") || s.includes("mutuelle")) {
    return "Focus watch: cotisation €, franchise, carence, tacite, exclusions, résiliation.";
  }
  if (s.includes("facture")) {
    return "Focus watch: total TTC €, échéance, pénalités retard, frais annexes (secondaires).";
  }
  if (s.includes("abonnement") || s.includes("internet") || s.includes("mobile")) {
    return "Focus watch: prix €, engagement, tacite, frais résiliation, matériel.";
  }
  if (s.includes("administratif") || s.includes("courrier")) {
    return "Focus watch: montant dû €, date limite, majoration %, pièces à fournir, conséquences non-paiement.";
  }
  return "Focus watch: montant principal dû €, échéances, obligations. Titres chiffrés et spécifiques.";
}

const SCHEMA_KEYS =
  "document_type,title,summary,important_points[{statement,excerpt}],risk_findings[{description,why,implication,consequence,mitigation,excerpt,confidence,severity,criterion_id}],risks[],actions[]";

/**
 * Bundle LLM Local First — prompt compact, sortie JSON minimale.
 */
export function buildCoreBundlePrompt(input: {
  categoryLabel: string;
  documentText: string;
  knowledgeBlock?: string;
  localFacts?: ExtractedFacts;
}): string {
  const ids = RISK_CRITERION_IDS.join(",");
  const factsHint = input.localFacts
    ? compactLocalFactsHint(input.localFacts)
    : "";

  const lines = [
    `Juriste FR — « ${input.categoryLabel} ». JSON strict, sans prose hors JSON.`,
    "Local First: dates/montants/personnes/org/échéances = serveur (ne pas regénérer). Montants locaux déjà labelisés.",
    "Factuel: cite DOCUMENT ou FAITS_LOCAUX. Excerpt = phrase utile du corps (pas en-tête/logo seul). Verbatim (<<<PAGE n>>>).",
    "risk_findings.description: titre court chiffré (ex. « Loyer : 1 050 €/mois »), jamais « Obligation de payer » vague.",
    "Prioriser montant PRINCIPAL dû/à payer; frais dossier/annexes en second plan. Pas capital social ni totaux nationaux.",
    "summary: 2 phrases concrètes. important_points/risk_findings ≤5 chacun; finding incomplet (sans why+implication+consequence+mitigation+excerpt) → omis.",
    categoryPriorityHint(input.categoryLabel),
    `actions: 1–5 diligences concrètes liées au doc. criterion_id∈{${ids}} prouvé par excerpt. severity: faible|modere|eleve|critique.`,
    `Schéma:{${SCHEMA_KEYS}}`,
  ];

  if (factsHint) lines.push(`FAITS_LOCAUX:${factsHint}`);

  const knowledge = input.knowledgeBlock?.trim();
  if (knowledge) lines.push(knowledge);

  lines.push("<<<DOCUMENT>>>", input.documentText.trim(), "<<<FIN>>>");

  return lines.join("\n");
}

/** Estimation tokens prompt (debug/bench). */
export function estimateCoreBundlePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 3.6);
}
