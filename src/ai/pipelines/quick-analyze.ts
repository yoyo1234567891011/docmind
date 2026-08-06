import { classifyDocumentHeuristic } from "@/ai/classification/heuristic";
import { localFacts } from "@/ai/agents/parse-specialists";
import { buildDocumentSheetFromAnalysis } from "@/services/sheets";
import { EMPTY_READY_REPLY } from "@/types";
import type {
  AnalyzeDocumentRequest,
  AnalyzeDocumentResult,
  DocumentAnalysis,
} from "@/types";
import type { ExtractedFacts } from "@/ai/agents/types";

function pickTitle(fileName: string | undefined, categoryLabel: string, text: string): string {
  const fromFile = fileName?.replace(/\.pdf$/i, "").trim();
  if (fromFile) return fromFile;

  const heading = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("#"));
  if (heading) {
    return heading
      .replace(/^#+\s*/, "")
      .replace(/\(.*?ficti[fv]e?.*?\)/gi, "")
      .replace(/\bdocument fictif\b/gi, "")
      .trim()
      .slice(0, 120);
  }

  return categoryLabel;
}

/**
 * Résumé 100 % local — aucune invention hors faits extraits.
 */
export function buildLocalPreviewSummary(input: {
  categoryLabel: string;
  facts: ExtractedFacts;
}): string {
  const parts: string[] = [`Document de type « ${input.categoryLabel} ».`];

  if (input.facts.organizations[0]) {
    parts.push(`Organisation identifiée : ${input.facts.organizations[0]}.`);
  }
  if (input.facts.people.length === 1) {
    parts.push(`Personne identifiée : ${input.facts.people[0]}.`);
  } else if (input.facts.people.length > 1) {
    parts.push(
      `Personnes identifiées : ${input.facts.people.slice(0, 3).join(", ")}.`,
    );
  }
  if (input.facts.amounts[0]) {
    parts.push(`Montant repéré : ${input.facts.amounts[0]}.`);
  }
  if (input.facts.deadlines[0]) {
    parts.push(`Échéance repérée : ${input.facts.deadlines[0]}.`);
  } else if (input.facts.date) {
    parts.push(`Date principale : ${input.facts.date}.`);
  }

  parts.push("L’analyse juridique complète est en cours.");
  return parts.join(" ");
}

function buildKeyPoints(facts: ExtractedFacts): string[] {
  const points: string[] = [];
  if (facts.organizations[0]) {
    points.push(`Organisation : ${facts.organizations[0]}`);
  }
  for (const person of facts.people.slice(0, 2)) {
    points.push(`Personne : ${person}`);
  }
  if (facts.amounts[0]) points.push(`Montant : ${facts.amounts[0]}`);
  if (facts.deadlines[0]) points.push(`Échéance : ${facts.deadlines[0]}`);
  if (facts.date && !facts.deadlines[0]) points.push(`Date : ${facts.date}`);
  return points.slice(0, 5);
}

/**
 * Phase 1 (preview) : extraction locale + résumé template.
 * Aucun appel Ollama — indépendant du GPU.
 */
export async function quickAnalyzeDocumentText(
  request: AnalyzeDocumentRequest,
): Promise<AnalyzeDocumentResult> {
  const text = request.text.trim();
  const classification = classifyDocumentHeuristic(text);
  const facts = localFacts(text);
  const analyzedAt = new Date().toISOString();
  const title = pickTitle(request.fileName, classification.label, text);
  const summary = buildLocalPreviewSummary({
    categoryLabel: classification.label,
    facts,
  });

  const analysis: DocumentAnalysis = {
    document_type: classification.label,
    title,
    summary,
    date: facts.date,
    dates: facts.dates,
    people: facts.people,
    organizations: facts.organizations,
    amounts: facts.amounts,
    deadlines: facts.deadlines,
    important_points: buildKeyPoints(facts),
    risks: [],
    actions: [],
    risk_score: 0,
    risk_level: "faible",
    risk_explanation:
      "Score non calculé — en attente de l’analyse juridique (phase 2).",
    risk_criteria: [],
  };

  return {
    documentId: request.documentId,
    classification,
    analysis,
    readyReply: EMPTY_READY_REPLY,
    model: "local-extract",
    analyzedAt,
    promptsUsed: [],
    phase: "preview",
    sheet: buildDocumentSheetFromAnalysis({
      documentId: request.documentId,
      fileName: request.fileName || "document.pdf",
      classification,
      analysis,
      analyzedAt,
    }),
  };
}
