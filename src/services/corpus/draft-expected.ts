import { localFacts } from "@/ai/agents/parse-specialists";
import type { ExpectedAnalysis } from "@/types/eval";
import type { AnonymizeReplacement } from "./anonymize";

export type DraftExpectedInput = {
  text: string;
  documentType?: string;
  title?: string;
  replacements?: AnonymizeReplacement[];
};

/**
 * Brouillon de vérité terrain à partir du texte anonymisé.
 * Les champs juridiques (summary, risks, actions…) restent à compléter à la main.
 */
export function draftExpectedAnalysis(
  input: DraftExpectedInput,
): ExpectedAnalysis {
  const facts = localFacts(input.text);
  const peopleFromMap = (input.replacements ?? [])
    .filter((r) => r.kind === "person")
    .map((r) => r.replacement);
  const orgsFromMap = (input.replacements ?? [])
    .filter((r) => r.kind === "organization")
    .map((r) => r.replacement);

  const people = unique([...(peopleFromMap.length ? peopleFromMap : facts.people)]);
  const organizations = unique([
    ...(orgsFromMap.length ? orgsFromMap : facts.organizations),
  ]);

  const title =
    input.title?.trim() ||
    firstHeading(input.text) ||
    input.documentType?.trim() ||
    "Document anonymisé";

  return {
    document_type: input.documentType?.trim() || "Autre",
    title,
    summary:
      "TODO: rédiger un résumé factuel attendu (après relecture humaine).",
    people,
    organizations,
    amounts: facts.amounts,
    dates: facts.dates.length ? facts.dates : facts.date ? [facts.date] : [],
    deadlines: facts.deadlines,
    important_points: [
      "TODO: point important 1 (clause / obligation clé)",
      "TODO: point important 2",
    ],
    risks: ["TODO: risque principal attendu"],
    actions: ["TODO: action recommandée attendue"],
    risk_score: 0,
  };
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out.slice(0, 12);
}

function firstHeading(text: string): string | undefined {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith("#"));
  if (!line) return undefined;
  return line.replace(/^#+\s*/, "").trim().slice(0, 120);
}
