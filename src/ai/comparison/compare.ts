import {
  EVAL_FIELDS,
  SEMANTIC_FIELDS,
  type EvalField,
  type ExpectedAnalysis,
  type FieldComparison,
  type SemanticDiff,
  type SemanticEvalField,
} from "@/types/eval";
import { semanticSimilarity } from "@/ai/models/embeddings";
import { docmindConfig } from "@/config/docmind";

const SEMANTIC_EQUIVALENT = docmindConfig.thresholds.semanticEquivalent;
const SEMANTIC_PARTIAL = docmindConfig.thresholds.semanticPartial;
const SEMANTIC_ARRAY_MATCH = docmindConfig.thresholds.semanticArrayMatch;
const SEMANTIC_ARRAY_PARTIAL = docmindConfig.thresholds.semanticArrayPartial;

const SEMANTIC_FIELD_SET = new Set<string>(SEMANTIC_FIELDS);

function isSemanticField(field: EvalField): field is SemanticEvalField {
  return SEMANTIC_FIELD_SET.has(field);
}

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

function tokens(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

const DEADLINE_FILLER =
  /\b(?:avant(?:\s+le)?|jusqu(?:'|’)(?:au)?|au\s+plus\s+tard(?:\s+le)?|dans\s+un\s+delai\s+de|date\s+limite(?:\s+de\s+paiement)?|echeance(?:\s+de\s+paiement)?|a\s+regler|payable|valable|notifier|adresser|transmettre|intervenir|attendu[e]?|exig[eé][e]?|doit(?:\s+[eê]tre)?|toute\s+demande\s+de\s+modification|le\s+reglement|votre\s+reponse|sous\s+peine[^.]*$)\b/gi;

interface DeadlineSignals {
  raw: string;
  normalized: string;
  dates: string[];
  durations: string[];
  keys: string[];
}

function toCanonicalDate(day: string, month: string, year: string): string {
  const y = year.length === 2 ? `20${year}` : year;
  return `${y}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function extractDeadlineDates(value: string): string[] {
  const dates = new Set<string>();
  const text = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  for (const match of text.matchAll(
    /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g,
  )) {
    dates.add(toCanonicalDate(match[1], match[2], match[3]));
  }

  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    dates.add(`${match[1]}-${match[2]}-${match[3]}`);
  }

  return [...dates];
}

function extractDeadlineDurations(value: string): string[] {
  const durations = new Set<string>();
  const text = normalize(value)
    .replace(/\bh\b/g, "heures")
    .replace(/\bhrs?\b/g, "heures");

  const patterns: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
    [
      /\b(\d+)\s*(jours?|j)\b/g,
      (m) => `${m[1]}j`,
    ],
    [
      /\b(\d+)\s*(mois|mo)\b/g,
      (m) => `${m[1]}mois`,
    ],
    [
      /\b(\d+)\s*(semaines?|sem)\b/g,
      (m) => `${m[1]}sem`,
    ],
    [
      /\b(\d+)\s*(heures?|h)\b/g,
      (m) => `${m[1]}h`,
    ],
    [
      /\b(\d+)\s*(ans?|annees?)\b/g,
      (m) => `${m[1]}an`,
    ],
    [
      /\b(quinze)\s+jours?\b/g,
      () => "15j",
    ],
    [
      /\b(huit)\s+jours?\b/g,
      () => "8j",
    ],
    [
      /\b(trente)\s+jours?\b/g,
      () => "30j",
    ],
    [
      /\b(soixante)\s+jours?\b/g,
      () => "60j",
    ],
  ];

  for (const [pattern, toKey] of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      durations.add(toKey(match));
    }
  }

  return [...durations];
}

/**
 * Strips boilerplate phrasing and keeps comparable deadline signals:
 * dates, durations, and remaining delay keywords.
 */
export function normalizeDeadline(value: string): DeadlineSignals {
  const raw = value.trim();
  const cleaned = normalize(raw)
    .replace(/jusqu au/g, " ")
    .replace(DEADLINE_FILLER, " ")
    .replace(/\s+/g, " ")
    .trim();

  const dates = extractDeadlineDates(raw);
  const durations = extractDeadlineDurations(raw);

  // Drop duration unit leftovers already captured as canonical durations.
  const contentTokens = cleaned
    .split(" ")
    .filter((token) => token.length > 2)
    .filter((token) => !/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$/.test(token))
    .filter((token) => !/^\d{4}-\d{2}-\d{2}$/.test(token))
    .filter(
      (token) =>
        !/^(jours?|j|mois|mo|semaines?|sem|heures?|h|ans?|annees?|moins)$/.test(
          token,
        ),
    )
    .filter((token) => !/^\d+$/.test(token));

  const keys = [...new Set([...dates, ...durations, ...contentTokens])].sort();

  return {
    raw,
    normalized: keys.join(" "),
    dates,
    durations,
    keys,
  };
}

function deadlineSimilarity(a: string, b: string): number {
  const left = normalizeDeadline(a);
  const right = normalizeDeadline(b);

  if (!left.normalized && !right.normalized) return 1;
  if (!left.keys.length || !right.keys.length) {
    return lexicalSimilarity(a, b);
  }

  const dateOverlap = left.dates.filter((date) => right.dates.includes(date));
  const durationOverlap = left.durations.filter((duration) =>
    right.durations.includes(duration),
  );

  // Strong match when a shared date or duration exists.
  if (dateOverlap.length > 0 || durationOverlap.length > 0) {
    const leftSet = new Set(left.keys);
    const rightSet = new Set(right.keys);
    let overlap = 0;
    for (const key of leftSet) {
      if (rightSet.has(key)) overlap += 1;
    }
    const union = new Set([...leftSet, ...rightSet]).size;
    const jaccard = union === 0 ? 0 : overlap / union;
    return Math.min(1, 0.75 + 0.25 * jaccard);
  }

  const leftSet = new Set(left.keys);
  const rightSet = new Set(right.keys);
  if (leftSet.size === 0 || rightSet.size === 0) return 0;

  let overlap = 0;
  for (const key of leftSet) {
    if (rightSet.has(key)) overlap += 1;
  }

  return (2 * overlap) / (leftSet.size + rightSet.size);
}

function compareDeadlines(
  expected: string[],
  predicted: string[],
): FieldComparison {
  const expectedItems = expected.map((item) => item.trim()).filter(Boolean);
  const predictedItems = predicted.map((item) => item.trim()).filter(Boolean);

  if (expectedItems.length === 0 && predictedItems.length === 0) {
    return {
      field: "deadlines",
      mode: "lexical",
      status: "correct",
      score: 1,
      expected: expectedItems,
      predicted: predictedItems,
      correctItems: [],
      errors: [],
      omissions: [],
      detail: "Listes vides (OK)",
    };
  }

  const matchedExpected = new Set<number>();
  const matchedPredicted = new Set<number>();
  const correctItems: string[] = [];

  expectedItems.forEach((item, index) => {
    let bestIndex = -1;
    let bestScore = 0;

    predictedItems.forEach((candidate, candidateIndex) => {
      if (matchedPredicted.has(candidateIndex)) return;
      const score = deadlineSimilarity(item, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = candidateIndex;
      }
    });

    if (bestIndex >= 0 && bestScore >= 0.55) {
      matchedExpected.add(index);
      matchedPredicted.add(bestIndex);
      correctItems.push(predictedItems[bestIndex]);
    }
  });

  const omissions = expectedItems.filter((_, index) => !matchedExpected.has(index));
  const errors = predictedItems.filter((_, index) => !matchedPredicted.has(index));

  const precision =
    predictedItems.length === 0 ? 0 : matchedPredicted.size / predictedItems.length;
  const recall =
    expectedItems.length === 0 ? 0 : matchedExpected.size / expectedItems.length;
  const score =
    precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  let status: FieldComparison["status"] = "error";
  if (omissions.length === 0 && errors.length === 0) status = "correct";
  else if (correctItems.length > 0 && (omissions.length > 0 || errors.length > 0)) {
    status = "partial";
  } else if (
    correctItems.length === 0 &&
    omissions.length > 0 &&
    predictedItems.length === 0
  ) {
    status = "omission";
  }

  return {
    field: "deadlines",
    mode: "lexical",
    status,
    score,
    expected: expectedItems,
    predicted: predictedItems,
    correctItems,
    errors: errors.map((item) => `En trop: "${item}"`),
    omissions: omissions.map((item) => `Manquant: "${item}"`),
    detail:
      `Deadlines normalisées (dates/durées) · Précision ${(precision * 100).toFixed(0)} % · ` +
      `Rappel ${(recall * 100).toFixed(0)} % · F1 ${(score * 100).toFixed(0)} %`,
  };
}

function lexicalSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);

  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;

  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;

  let overlap = 0;
  for (const token of ta) {
    if (tb.has(token)) overlap += 1;
  }

  return (2 * overlap) / (ta.size + tb.size);
}

function compareStrings(
  field: EvalField,
  expected: string,
  predicted: string,
): FieldComparison {
  const score = lexicalSimilarity(expected, predicted);
  let status: FieldComparison["status"] = "error";

  if (!expected && !predicted) {
    status = "correct";
  } else if (!expected && predicted) {
    status = "error";
  } else if (expected && !predicted) {
    status = "omission";
  } else if (score >= 0.85) {
    status = "correct";
  } else if (score >= 0.45) {
    status = "partial";
  } else {
    status = "error";
  }

  return {
    field,
    mode: "lexical",
    status,
    score: !expected && !predicted ? 1 : score,
    expected,
    predicted,
    correctItems: status === "correct" || status === "partial" ? [predicted] : [],
    errors:
      status === "error" && predicted
        ? [`Prédit: "${predicted}"`]
        : [],
    omissions:
      status === "omission" || (status === "error" && expected)
        ? [`Attendu: "${expected}"`]
        : status === "partial"
          ? [`Correspondance partielle avec "${expected}"`]
          : [],
    detail:
      status === "correct"
        ? "Correspondance correcte"
        : status === "partial"
          ? `Correspondance partielle (${Math.round(score * 100)} %)`
          : status === "omission"
            ? "Valeur absente de la prédiction"
            : "Valeur incorrecte",
  };
}

function compareArrays(
  field: EvalField,
  expected: string[],
  predicted: string[],
): FieldComparison {
  const expectedItems = expected.map((item) => item.trim()).filter(Boolean);
  const predictedItems = predicted.map((item) => item.trim()).filter(Boolean);

  if (expectedItems.length === 0 && predictedItems.length === 0) {
    return {
      field,
      mode: "lexical",
      status: "correct",
      score: 1,
      expected: expectedItems,
      predicted: predictedItems,
      correctItems: [],
      errors: [],
      omissions: [],
      detail: "Listes vides (OK)",
    };
  }

  const matchedExpected = new Set<number>();
  const matchedPredicted = new Set<number>();
  const correctItems: string[] = [];

  expectedItems.forEach((item, index) => {
    let bestIndex = -1;
    let bestScore = 0;

    predictedItems.forEach((candidate, candidateIndex) => {
      if (matchedPredicted.has(candidateIndex)) return;
      const score = lexicalSimilarity(item, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = candidateIndex;
      }
    });

    if (bestIndex >= 0 && bestScore >= 0.55) {
      matchedExpected.add(index);
      matchedPredicted.add(bestIndex);
      correctItems.push(predictedItems[bestIndex]);
    }
  });

  const omissions = expectedItems.filter((_, index) => !matchedExpected.has(index));
  const errors = predictedItems.filter((_, index) => !matchedPredicted.has(index));

  const precision =
    predictedItems.length === 0 ? 0 : matchedPredicted.size / predictedItems.length;
  const recall =
    expectedItems.length === 0 ? 0 : matchedExpected.size / expectedItems.length;
  const score =
    precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  let status: FieldComparison["status"] = "error";
  if (omissions.length === 0 && errors.length === 0) status = "correct";
  else if (correctItems.length > 0 && (omissions.length > 0 || errors.length > 0)) {
    status = "partial";
  } else if (correctItems.length === 0 && omissions.length > 0 && predictedItems.length === 0) {
    status = "omission";
  }

  return {
    field,
    mode: "lexical",
    status,
    score,
    expected: expectedItems,
    predicted: predictedItems,
    correctItems,
    errors: errors.map((item) => `En trop: "${item}"`),
    omissions: omissions.map((item) => `Manquant: "${item}"`),
    detail: `Précision ${(precision * 100).toFixed(0)} % · Rappel ${(recall * 100).toFixed(0)} % · F1 ${(score * 100).toFixed(0)} %`,
  };
}

async function compareSemanticString(
  field: SemanticEvalField,
  expected: string,
  predicted: string,
): Promise<FieldComparison> {
  const expectedText = expected.trim();
  const predictedText = predicted.trim();

  if (!expectedText && !predictedText) {
    return {
      field,
      mode: "semantic",
      status: "correct",
      score: 1,
      expected: expectedText,
      predicted: predictedText,
      correctItems: [],
      errors: [],
      omissions: [],
      detail: "Résumés vides (OK)",
      diffs: [],
    };
  }

  if (expectedText && !predictedText) {
    return {
      field,
      mode: "semantic",
      status: "omission",
      score: 0,
      expected: expectedText,
      predicted: predictedText,
      correctItems: [],
      errors: [],
      omissions: [`Attendu: "${expectedText}"`],
      detail: "Résumé absent de la prédiction",
      diffs: [
        {
          kind: "missing",
          expected: expectedText,
          similarity: 0,
          note: "Aucun résumé prédit — sens attendu manquant",
        },
      ],
    };
  }

  if (!expectedText && predictedText) {
    return {
      field,
      mode: "semantic",
      status: "error",
      score: 0,
      expected: expectedText,
      predicted: predictedText,
      correctItems: [],
      errors: [`Prédit: "${predictedText}"`],
      omissions: [],
      detail: "Résumé prédit alors qu'aucun résumé n'était attendu",
      diffs: [
        {
          kind: "extra",
          predicted: predictedText,
          similarity: 0,
          note: "Résumé superflu (rien n'était attendu)",
        },
      ],
    };
  }

  const score = await semanticSimilarity(expectedText, predictedText);
  let status: FieldComparison["status"] = "error";
  let kind: SemanticDiff["kind"] = "divergent";

  if (score >= SEMANTIC_EQUIVALENT) {
    status = "correct";
    kind = "equivalent";
  } else if (score >= SEMANTIC_PARTIAL) {
    status = "partial";
    kind = "partial";
  }

  const note =
    kind === "equivalent"
      ? "Sens équivalent (formulation différente tolérée)"
      : kind === "partial"
        ? "Sens partiellement proche — écarts de contenu possibles"
        : "Sens divergent — différence réelle de contenu";

  return {
    field,
    mode: "semantic",
    status,
    score,
    expected: expectedText,
    predicted: predictedText,
    correctItems: status === "correct" || status === "partial" ? [predictedText] : [],
    errors:
      status === "error"
        ? [`Sens divergent (${Math.round(score * 100)} %)`]
        : [],
    omissions:
      status === "partial"
        ? [`Écart sémantique avec l'attendu (${Math.round(score * 100)} %)`]
        : [],
    detail: `Similarité sémantique ${(score * 100).toFixed(0)} % · ${note}`,
    diffs: [
      {
        kind,
        expected: expectedText,
        predicted: predictedText,
        similarity: score,
        note,
      },
    ],
  };
}

async function compareSemanticArrays(
  field: SemanticEvalField,
  expected: string[],
  predicted: string[],
): Promise<FieldComparison> {
  const expectedItems = expected.map((item) => item.trim()).filter(Boolean);
  const predictedItems = predicted.map((item) => item.trim()).filter(Boolean);

  if (expectedItems.length === 0 && predictedItems.length === 0) {
    return {
      field,
      mode: "semantic",
      status: "correct",
      score: 1,
      expected: expectedItems,
      predicted: predictedItems,
      correctItems: [],
      errors: [],
      omissions: [],
      detail: "Listes vides (OK)",
      diffs: [],
    };
  }

  const pairScores: Array<{
    expectedIndex: number;
    predictedIndex: number;
    score: number;
  }> = [];

  for (let i = 0; i < expectedItems.length; i += 1) {
    for (let j = 0; j < predictedItems.length; j += 1) {
      const score = await semanticSimilarity(expectedItems[i], predictedItems[j]);
      pairScores.push({ expectedIndex: i, predictedIndex: j, score });
    }
  }

  pairScores.sort((a, b) => b.score - a.score);

  const matchedExpected = new Set<number>();
  const matchedPredicted = new Set<number>();
  const diffs: SemanticDiff[] = [];
  const correctItems: string[] = [];
  let matchedScoreSum = 0;
  let matchedCount = 0;

  for (const pair of pairScores) {
    if (matchedExpected.has(pair.expectedIndex)) continue;
    if (matchedPredicted.has(pair.predictedIndex)) continue;
    if (pair.score < SEMANTIC_ARRAY_PARTIAL) continue;

    matchedExpected.add(pair.expectedIndex);
    matchedPredicted.add(pair.predictedIndex);
    matchedScoreSum += pair.score;
    matchedCount += 1;

    const expectedText = expectedItems[pair.expectedIndex];
    const predictedText = predictedItems[pair.predictedIndex];
    const equivalent = pair.score >= SEMANTIC_ARRAY_MATCH;

    correctItems.push(predictedText);
    diffs.push({
      kind: equivalent ? "equivalent" : "partial",
      expected: expectedText,
      predicted: predictedText,
      similarity: pair.score,
      note: equivalent
        ? `Sens équivalent (${Math.round(pair.score * 100)} %)`
        : `Sens partiel (${Math.round(pair.score * 100)} %) — formulation ou détail différent`,
    });
  }

  for (let i = 0; i < expectedItems.length; i += 1) {
    if (matchedExpected.has(i)) continue;
    diffs.push({
      kind: "missing",
      expected: expectedItems[i],
      similarity: 0,
      note: "Point attendu non couvert sémantiquement",
    });
  }

  for (let j = 0; j < predictedItems.length; j += 1) {
    if (matchedPredicted.has(j)) continue;
    diffs.push({
      kind: "extra",
      predicted: predictedItems[j],
      similarity: 0,
      note: "Point prédit sans équivalent attendu (ajout réel)",
    });
  }

  const missingDiffs = diffs.filter((diff) => diff.kind === "missing");
  const extraDiffs = diffs.filter((diff) => diff.kind === "extra");
  const partialDiffs = diffs.filter((diff) => diff.kind === "partial");
  const equivalentCount = diffs.filter((diff) => diff.kind === "equivalent").length;

  const omissions = missingDiffs.map(
    (diff) => `Manquant (sens): "${diff.expected}"`,
  );
  const errors = [
    ...extraDiffs.map((diff) => `En trop (sens): "${diff.predicted}"`),
    ...partialDiffs.map(
      (diff) =>
        `Partiel ${Math.round(diff.similarity * 100)} %: "${diff.expected}" ↔ "${diff.predicted}"`,
    ),
  ];

  const precision =
    predictedItems.length === 0 ? 0 : matchedPredicted.size / predictedItems.length;
  const recall =
    expectedItems.length === 0 ? 0 : matchedExpected.size / expectedItems.length;
  const f1 =
    precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const quality =
    matchedCount === 0 ? 0 : matchedScoreSum / matchedCount;
  const score = f1 * (0.55 + 0.45 * quality);

  let status: FieldComparison["status"] = "error";
  if (
    missingDiffs.length === 0 &&
    extraDiffs.length === 0 &&
    partialDiffs.length === 0
  ) {
    status = "correct";
  } else if (matchedCount > 0) {
    status = "partial";
  } else if (expectedItems.length > 0 && predictedItems.length === 0) {
    status = "omission";
  }

  return {
    field,
    mode: "semantic",
    status,
    score,
    expected: expectedItems,
    predicted: predictedItems,
    correctItems,
    errors,
    omissions,
    detail:
      `Sémantique · F1 ${(f1 * 100).toFixed(0)} % · qualité ${(quality * 100).toFixed(0)} % · ` +
      `${equivalentCount} équivalent(s), ${partialDiffs.length} partiel(s), ` +
      `${missingDiffs.length} manquant(s), ${extraDiffs.length} en trop`,
    diffs,
  };
}

function compareRiskScore(
  expected: number,
  predicted: number,
): FieldComparison {
  const diff = Math.abs(expected - predicted);
  const score = Math.max(0, 1 - diff / 100);
  const tolerance = docmindConfig.thresholds.riskScoreTolerance;
  const status =
    diff <= Math.min(10, tolerance)
      ? "correct"
      : diff <= Math.max(25, tolerance)
        ? "partial"
        : predicted
          ? "error"
          : "omission";

  return {
    field: "risk_score",
    mode: "numeric",
    status,
    score,
    expected,
    predicted,
    correctItems: status === "correct" ? [`${predicted}`] : [],
    errors:
      status === "error"
        ? [`Score prédit ${predicted} trop éloigné de ${expected}`]
        : [],
    omissions:
      status === "omission"
        ? [`Score attendu ${expected}`]
        : status === "partial"
          ? [`Écart de ${diff} points avec ${expected}`]
          : [],
    detail: `Attendu ${expected} · Prédit ${predicted} · Écart ${diff}`,
  };
}

export function toPredictedShape(analysis: {
  document_type: string;
  title: string;
  summary?: string;
  date?: string;
  dates?: string[];
  people: string[];
  organizations: string[];
  amounts: string[];
  deadlines: string[];
  important_points: string[];
  risks: string[];
  actions: string[];
  risk_score: number;
}): ExpectedAnalysis {
  const dates = [
    ...(analysis.dates ?? []),
    ...(analysis.date ? [analysis.date] : []),
  ];

  return {
    document_type: analysis.document_type ?? "",
    title: analysis.title ?? "",
    summary: analysis.summary ?? "",
    people: analysis.people ?? [],
    organizations: analysis.organizations ?? [],
    amounts: analysis.amounts ?? [],
    dates: [...new Set(dates.filter(Boolean))],
    deadlines: analysis.deadlines ?? [],
    important_points: analysis.important_points ?? [],
    risks: analysis.risks ?? [],
    actions: analysis.actions ?? [],
    risk_score: analysis.risk_score ?? 0,
  };
}

export async function compareAnalysis(
  expected: ExpectedAnalysis,
  predicted: ExpectedAnalysis,
): Promise<FieldComparison[]> {
  const fields: FieldComparison[] = [];

  for (const field of EVAL_FIELDS) {
    if (field === "risk_score") {
      fields.push(compareRiskScore(expected.risk_score, predicted.risk_score));
      continue;
    }

    const expectedValue = expected[field];
    const predictedValue = predicted[field];

    if (isSemanticField(field)) {
      if (field === "summary") {
        fields.push(
          await compareSemanticString(
            field,
            String(expectedValue ?? ""),
            String(predictedValue ?? ""),
          ),
        );
      } else {
        fields.push(
          await compareSemanticArrays(
            field,
            (expectedValue as string[]) ?? [],
            (predictedValue as string[]) ?? [],
          ),
        );
      }
      continue;
    }

    if (field === "deadlines") {
      fields.push(
        compareDeadlines(
          (expectedValue as string[]) ?? [],
          (predictedValue as string[]) ?? [],
        ),
      );
      continue;
    }

    if (Array.isArray(expectedValue) || Array.isArray(predictedValue)) {
      fields.push(
        compareArrays(
          field,
          (expectedValue as string[]) ?? [],
          (predictedValue as string[]) ?? [],
        ),
      );
      continue;
    }

    fields.push(
      compareStrings(
        field,
        String(expectedValue ?? ""),
        String(predictedValue ?? ""),
      ),
    );
  }

  return fields;
}

export function averageScore(fields: FieldComparison[]): number {
  if (fields.length === 0) return 0;
  const total = fields.reduce((sum, field) => sum + field.score, 0);
  return total / fields.length;
}
