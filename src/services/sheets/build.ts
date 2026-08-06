import { extractEuroAmounts } from "@/services/search/parse-values";
import {
  computeSheetConfidence,
  extractSheetKeywords,
} from "@/services/sheets/keywords";
import type {
  DocumentAnalysis,
  DocumentClassification,
  DocumentSheet,
  HistoryRecord,
} from "@/types";

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export type BuildSheetInput = {
  historyId?: string;
  documentId: string;
  fileName: string;
  classification: DocumentClassification;
  analysis: DocumentAnalysis;
  analyzedAt: string;
  createdAt?: string;
  displayName?: string | null;
};

/**
 * Construit une fiche mémoire à partir de l’analyse (avec ou sans historique).
 */
export function buildDocumentSheetFromAnalysis(
  input: BuildSheetInput,
): DocumentSheet {
  const analysis = input.analysis;
  const name =
    input.displayName?.trim() ||
    analysis.title?.trim() ||
    input.fileName;

  const dates = uniqueStrings([analysis.date, ...(analysis.dates ?? [])]);
  const amounts = uniqueStrings(analysis.amounts ?? []);
  const now = new Date().toISOString();

  return {
    historyId: input.historyId ?? "",
    documentId: input.documentId,
    name,
    type: analysis.document_type || input.classification.label,
    category: input.classification.category,
    categoryLabel: input.classification.label,
    summary: analysis.summary?.trim() || "",
    people: uniqueStrings(analysis.people ?? []),
    organizations: uniqueStrings(analysis.organizations ?? []),
    amounts,
    amountValues: extractEuroAmounts(amounts),
    dates,
    deadlines: uniqueStrings(analysis.deadlines ?? []),
    risks: uniqueStrings(analysis.risks ?? []),
    actions: uniqueStrings(analysis.actions ?? []),
    keywords: extractSheetKeywords(analysis, input.classification),
    confidence: computeSheetConfidence(analysis, input.classification),
    riskLevel: analysis.risk_level,
    riskScore: analysis.risk_score ?? 0,
    fileName: input.fileName,
    analyzedAt: input.analyzedAt,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

/**
 * Construit une fiche structurée à partir d’un enregistrement d’historique.
 */
export function buildDocumentSheet(record: HistoryRecord): DocumentSheet {
  return buildDocumentSheetFromAnalysis({
    historyId: record.id,
    documentId: record.documentId,
    fileName: record.fileName,
    classification: record.classification,
    analysis: record.analysis,
    analyzedAt: record.analyzedAt,
    createdAt: record.createdAt,
    displayName: record.displayName,
  });
}

/** Texte aplati pour indexation mots-clés + embeddings. */
export function buildSheetSearchText(sheet: DocumentSheet): string {
  return [
    sheet.name,
    sheet.type,
    sheet.categoryLabel,
    sheet.summary,
    ...sheet.people,
    ...sheet.organizations,
    ...sheet.amounts,
    ...sheet.dates,
    ...sheet.deadlines,
    ...sheet.risks,
    ...sheet.actions,
    ...sheet.keywords,
    sheet.fileName,
    `risque ${sheet.riskLevel}`,
    `score ${sheet.riskScore}`,
    `confiance ${Math.round(sheet.confidence * 100)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function ensureDocumentSheet(record: HistoryRecord): DocumentSheet {
  const existing = record.sheet;
  if (
    existing?.historyId === record.id &&
    existing.name &&
    Array.isArray(existing.keywords) &&
    typeof existing.confidence === "number"
  ) {
    return existing;
  }
  return buildDocumentSheet(record);
}
