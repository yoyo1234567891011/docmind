import { isDictionaryDefinitionSnippet } from "@/ai/post-processing/prod-quality";
import type { RiskCriterionDefinition } from "@/services/risk/criteria";
import type { RiskCriterionResult } from "@/types";

function collectSearchCorpus(parts: string[]): string {
  return parts.filter(Boolean).join("\n");
}

function findMatchingSnippets(
  text: string,
  pattern: RegExp,
  limit = 2,
): string[] {
  const snippets: string[] = [];
  const lines = text
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (pattern.test(line) && !isDictionaryDefinitionSnippet(line)) {
      snippets.push(line.slice(0, 160));
    }
    if (snippets.length >= limit) break;
  }

  return snippets;
}

function scoreFromMatchCount(matchCount: number, maxScore: number): number {
  if (matchCount <= 0) return 0;
  if (matchCount === 1) return Math.round(maxScore * 0.7);
  if (matchCount === 2) return Math.round(maxScore * 0.9);
  return maxScore;
}

export function detectRiskCriterion(
  criterion: RiskCriterionDefinition,
  corpus: string,
): RiskCriterionResult {
  const reasons: string[] = [];
  let matchCount = 0;

  for (const pattern of criterion.patterns) {
    const snippets = findMatchingSnippets(corpus, pattern, 1);
    if (snippets.length > 0) {
      matchCount += 1;
      reasons.push(...snippets);
    }
  }

  const uniqueReasons = [...new Set(reasons)].slice(0, 3);
  const score = scoreFromMatchCount(matchCount, criterion.maxScore);

  return {
    id: criterion.id,
    label: criterion.label,
    detected: score > 0,
    score,
    max_score: criterion.maxScore,
    reasons: uniqueReasons,
  };
}

export function buildRiskCorpus(parts: {
  documentText: string;
  risks: string[];
  importantPoints: string[];
  deadlines: string[];
  actions: string[];
}): string {
  return collectSearchCorpus([
    parts.documentText,
    ...parts.risks,
    ...parts.importantPoints,
    ...parts.deadlines,
    ...parts.actions,
  ]);
}
