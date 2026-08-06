import {
  averageScore,
  compareAnalysis,
} from "../../src/ai/evaluator";
import {
  buildDocumentLocusIndex,
  locateExcerptCitation,
} from "../../src/ai/reasoning/citations";
import type { ExpectedAnalysis, FieldComparison } from "../../src/types/eval";

import type { BenchmarkDoc, DocProviderScore, ProviderPrediction } from "./types";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/€/g, "eur")
    .replace(/[^a-z0-9%./\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Taux d’hallucination ≈ part des items « en trop » (extras) sur champs listes. */
export function hallucinationRateFromFields(fields: FieldComparison[]): number {
  const listFields = new Set([
    "people",
    "organizations",
    "amounts",
    "dates",
    "deadlines",
    "important_points",
    "risks",
    "actions",
  ]);
  let extras = 0;
  let totalPredicted = 0;
  for (const field of fields) {
    if (!listFields.has(field.field)) continue;
    const predicted = Array.isArray(field.predicted)
      ? (field.predicted as string[])
      : [];
    totalPredicted += predicted.length;
    extras += field.errors.filter((e) =>
      /trop|extra|en trop|invent/i.test(e),
    ).length;
    // diffs semantic extras
    if (field.diffs) {
      extras += field.diffs.filter((d) => d.kind === "extra").length;
    }
  }
  if (totalPredicted === 0) return extras > 0 ? 1 : 0;
  return Math.min(1, extras / totalPredicted);
}

/** Recall OCR / extraction : faits attendus (montants, dates, personnes, orgs) retrouvés. */
export function ocrRecallScore(
  expected: ExpectedAnalysis,
  predicted: ExpectedAnalysis,
): number {
  const keys: Array<keyof ExpectedAnalysis> = [
    "amounts",
    "dates",
    "people",
    "organizations",
  ];
  let hit = 0;
  let total = 0;
  for (const key of keys) {
    const exp = expected[key];
    if (!Array.isArray(exp)) continue;
    const predNorm = (predicted[key] as string[]).map(normalize);
    for (const item of exp) {
      const n = normalize(String(item));
      if (n.length < 2) continue;
      total += 1;
      if (predNorm.some((p) => p.includes(n) || n.includes(p))) hit += 1;
    }
  }
  return total === 0 ? 0 : hit / total;
}

/** Fidélité citations : extraits localisables dans le texte source. */
export function citationFaithfulness(
  sourceText: string,
  citations: Array<{ excerpt: string }> | undefined,
  predicted: ExpectedAnalysis,
  pages?: string[],
): number {
  const excerpts =
    citations && citations.length > 0
      ? citations.map((c) => c.excerpt)
      : [...predicted.important_points, ...predicted.risks].slice(0, 12);

  if (excerpts.length === 0) return 0;

  const loci = buildDocumentLocusIndex(pages, sourceText);
  let ok = 0;
  let total = 0;
  for (const excerpt of excerpts) {
    if (excerpt.trim().length < 8) continue;
    total += 1;
    const located = locateExcerptCitation(excerpt, loci);
    if (located) {
      ok += 1;
      continue;
    }
    if (normalize(sourceText).includes(normalize(excerpt).slice(0, 40))) {
      ok += 1;
    }
  }
  return total === 0 ? 0 : ok / total;
}

export async function scoreProviderDoc(input: {
  doc: BenchmarkDoc;
  prediction: ProviderPrediction;
  sourceText: string;
}): Promise<DocProviderScore> {
  const { doc, prediction, sourceText } = input;
  if (prediction.error) {
    return {
      provider: prediction.provider,
      relativePath: doc.relativePath,
      suites: doc.suites,
      quality: 0,
      hallucinationRate: 1,
      citationRate: 0,
      ocrRecall: 0,
      durationMs: prediction.durationMs,
      model: prediction.model,
      inputMode: prediction.inputMode,
      fields: [],
      error: prediction.error,
    };
  }

  try {
    const fields = await compareAnalysis(doc.expected, prediction.predicted);
    const quality = averageScore(fields);
    const hallucinationRate = hallucinationRateFromFields(fields);
    const citationRate = citationFaithfulness(
      sourceText,
      prediction.citations,
      prediction.predicted,
    );
    const ocrRecall = ocrRecallScore(doc.expected, prediction.predicted);

    return {
      provider: prediction.provider,
      relativePath: doc.relativePath,
      suites: doc.suites,
      quality,
      hallucinationRate,
      citationRate,
      ocrRecall,
      durationMs: prediction.durationMs,
      model: prediction.model,
      inputMode: prediction.inputMode,
      fields,
    };
  } catch (error) {
    return {
      provider: prediction.provider,
      relativePath: doc.relativePath,
      suites: doc.suites,
      quality: 0,
      hallucinationRate: 1,
      citationRate: 0,
      ocrRecall: 0,
      durationMs: prediction.durationMs,
      model: prediction.model,
      inputMode: prediction.inputMode,
      fields: [],
      error:
        prediction.error ||
        (error instanceof Error ? error.message : String(error)),
    };
  }
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
