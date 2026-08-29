import {
  dateInRange,
  dateInYear,
  extractDateCandidates,
  extractEuroAmounts,
  includesNormalized,
} from "@/services/search/parse-values";
import { toHistoryListItem } from "@/services/history/query";
import { ensureDocumentSheet } from "@/services/sheets";
import type {
  DocumentSheet,
  HistoryRecord,
  SmartSearchAmountFilter,
  SmartSearchHit,
  SmartSearchIntent,
  SmartSearchMatchReason,
  SmartSearchMatchSource,
} from "@/types";

function matchesAmountValues(
  values: number[],
  filter: SmartSearchAmountFilter,
): boolean {
  if (values.length === 0) return false;

  return values.some((value) => {
    switch (filter.operator) {
      case "gt":
        return value > filter.value;
      case "gte":
        return value >= filter.value;
      case "lt":
        return value < filter.value;
      case "lte":
        return value <= filter.value;
      case "eq":
        return Math.abs(value - filter.value) < 0.009;
      case "between":
        return (
          value >= filter.value &&
          value <= (filter.valueMax ?? filter.value)
        );
      default:
        return false;
    }
  });
}

function collectAmountValues(
  sheet: DocumentSheet,
  analysisAmounts: string[],
  scope: SmartSearchMatchSource,
): number[] {
  if (sheet.amountValues?.length) return sheet.amountValues;
  const source =
    sheet.amounts.length > 0
      ? sheet.amounts
      : scope === "document"
        ? analysisAmounts
        : sheet.amounts;
  return extractEuroAmounts(source);
}

function collectRecordDates(
  record: HistoryRecord,
  field: NonNullable<SmartSearchIntent["date"]>["field"],
  scope: SmartSearchMatchSource,
): Date[] {
  const sheet = ensureDocumentSheet(record);
  const analysis = record.analysis;

  if (field === "deadline") {
    const deadlines =
      sheet.deadlines.length > 0
        ? sheet.deadlines
        : scope === "document"
          ? analysis.deadlines
          : sheet.deadlines;
    return extractDateCandidates(deadlines);
  }
  if (field === "document") {
    const dates =
      sheet.dates.length > 0
        ? sheet.dates
        : scope === "document"
          ? [analysis.date, ...analysis.dates]
          : sheet.dates;
    return extractDateCandidates(dates);
  }
  if (field === "analyzed") {
    const analyzed = new Date(record.analyzedAt);
    return Number.isNaN(analyzed.getTime()) ? [] : [analyzed];
  }

  const values =
    scope === "sheet"
      ? [...sheet.dates, ...sheet.deadlines]
      : [
          ...sheet.dates,
          ...sheet.deadlines,
          analysis.date,
          ...analysis.dates,
          ...analysis.deadlines,
        ];
  return extractDateCandidates(values);
}

function buildSheetHaystack(
  sheet: DocumentSheet,
  record: HistoryRecord,
): string {
  return [
    sheet.name,
    sheet.type,
    sheet.categoryLabel,
    sheet.summary,
    ...sheet.organizations,
    ...sheet.people,
    ...sheet.amounts,
    ...sheet.dates,
    ...sheet.deadlines,
    ...sheet.risks,
    ...sheet.actions,
    ...(sheet.keywords ?? []),
    record.fileName,
  ].join(" \n ");
}

function buildDocumentHaystack(
  sheet: DocumentSheet,
  record: HistoryRecord,
): string {
  const analysis = record.analysis;
  return [
    buildSheetHaystack(sheet, record),
    analysis.title,
    analysis.summary,
    ...analysis.important_points,
    ...analysis.risks,
    ...analysis.actions,
    record.extractedText.slice(0, 6000),
  ].join(" \n ");
}

function hasHardFilters(intent: SmartSearchIntent): boolean {
  return (
    intent.organizations.length > 0 ||
    intent.people.length > 0 ||
    intent.documentTypes.length > 0 ||
    intent.categories.length > 0 ||
    Boolean(intent.amount) ||
    Boolean(intent.date) ||
    (intent.riskLevels != null && intent.riskLevels.length > 0) ||
    intent.folderId !== undefined ||
    intent.needsAction != null
  );
}

function scoreRecord(
  record: HistoryRecord,
  intent: SmartSearchIntent,
  scope: SmartSearchMatchSource,
): SmartSearchHit | null {
  const reasons: SmartSearchMatchReason[] = [];
  const highlights: string[] = [];
  let score = 0;

  const analysis = record.analysis;
  const sheet = ensureDocumentSheet(record);
  const haystack =
    scope === "sheet"
      ? buildSheetHaystack(sheet, record)
      : buildDocumentHaystack(sheet, record);

  const hard = hasHardFilters(intent);

  // Keywords: hard only when there is no structural filter; otherwise soft boost
  if (intent.keywords.length > 0) {
    const matched = intent.keywords.filter((keyword) =>
      includesNormalized(haystack, keyword),
    );
    if (matched.length === 0 && !hard) return null;
    if (matched.length > 0) {
      score += matched.length * (scope === "sheet" ? 3 : 2);
      reasons.push({
        code: "keyword",
        label: `Mots-clés : ${matched.slice(0, 4).join(", ")}`,
      });
      highlights.push(...matched.slice(0, 3));
    }
  }

  if (intent.organizations.length > 0) {
    const matchedOrgs = intent.organizations.filter(
      (org) =>
        sheet.organizations.some((value) => includesNormalized(value, org)) ||
        includesNormalized(haystack, org),
    );
    if (matchedOrgs.length === 0) return null;
    score += matchedOrgs.length * 5;
    reasons.push({
      code: "organization",
      label: `Organisation : ${matchedOrgs.join(", ")}`,
    });
    highlights.push(...matchedOrgs);
  }

  if (intent.people.length > 0) {
    const matchedPeople = intent.people.filter((person) =>
      sheet.people.some((value) => includesNormalized(value, person)) ||
      (scope === "document" && includesNormalized(haystack, person)),
    );
    if (matchedPeople.length === 0) return null;
    score += matchedPeople.length * 4;
    reasons.push({
      code: "person",
      label: `Personne : ${matchedPeople.join(", ")}`,
    });
  }

  if (intent.documentTypes.length > 0) {
    const matchedTypes = intent.documentTypes.filter(
      (type) =>
        includesNormalized(sheet.type, type) ||
        includesNormalized(sheet.name, type) ||
        includesNormalized(sheet.categoryLabel, type) ||
        includesNormalized(haystack, type),
    );
    if (matchedTypes.length === 0) return null;
    score += matchedTypes.length * 3;
    reasons.push({
      code: "document_type",
      label: `Type : ${matchedTypes.join(", ")}`,
    });
  }

  if (intent.categories.length > 0) {
    if (!intent.categories.includes(sheet.category)) {
      return null;
    }
    score += 3;
    reasons.push({
      code: "category",
      label: `Catégorie : ${sheet.categoryLabel}`,
    });
  }

  if (intent.amount) {
    const values = collectAmountValues(sheet, analysis.amounts, scope);
    if (!matchesAmountValues(values, intent.amount)) return null;
    score += 6;
    reasons.push({
      code: "amount",
      label: `Montant ${intent.amount.operator} ${intent.amount.value} €`,
    });
    highlights.push(
      ...(sheet.amounts.length > 0 ? sheet.amounts : analysis.amounts)
        .filter((amount) => amount.includes("€"))
        .slice(0, 2),
    );
  }

  if (intent.date) {
    const dates = collectRecordDates(record, intent.date.field, scope);
    if (dates.length === 0) return null;

    const ok = dates.some((date) => {
      if (intent.date?.year != null && !dateInYear(date, intent.date.year)) {
        return false;
      }
      return dateInRange(date, intent.date?.from, intent.date?.to);
    });
    if (!ok) return null;

    score += 6;
    reasons.push({
      code: intent.date.field === "deadline" ? "deadline" : "date",
      label: intent.date.year
        ? `Échéance / date en ${intent.date.year}`
        : "Date correspondante",
    });
  }

  if (intent.riskLevels && intent.riskLevels.length > 0) {
    if (!intent.riskLevels.includes(sheet.riskLevel)) return null;
    score += 2;
    reasons.push({
      code: "risk",
      label: `Risque : ${sheet.riskLevel}`,
    });
  }

  if (intent.folderId !== undefined) {
    if ((record.folderId ?? null) !== intent.folderId) return null;
    score += 1;
    reasons.push({ code: "folder", label: "Dossier correspondant" });
  }

  if (intent.needsAction === true) {
    const item = toHistoryListItem(record);
    if (!item.needsAction) return null;
    score += 2;
    reasons.push({ code: "action", label: "Document nécessitant une action" });
  }

  if (scope === "sheet") {
    score += 4;
    reasons.push({ code: "sheet", label: "Trouvé via fiche structurée" });
  } else {
    score += 1;
    reasons.push({
      code: "full_text",
      label: "Complété via texte du document",
    });
  }

  const hasConstraint =
    intent.keywords.length > 0 ||
    hard;

  if (!hasConstraint) return null;

  // Keyword-only queries must have matched at least one keyword
  if (!hard && intent.keywords.length > 0) {
    const matched = intent.keywords.some((keyword) =>
      includesNormalized(haystack, keyword),
    );
    if (!matched) return null;
  }

  return {
    item: toHistoryListItem(record),
    score,
    reasons,
    highlights: [...new Set(highlights)].slice(0, 5),
    matchedOn: scope,
  };
}

/**
 * Recherche en 2 passes :
 * 1) fiches structurées uniquement
 * 2) texte complet uniquement pour les documents non trouvés en passe 1
 */
function matchRecordsToIntentPass(
  records: HistoryRecord[],
  intent: SmartSearchIntent,
): SmartSearchHit[] {
  const hits: SmartSearchHit[] = [];
  const matchedIds = new Set<string>();

  for (const record of records) {
    const hit = scoreRecord(record, intent, "sheet");
    if (hit) {
      hits.push(hit);
      matchedIds.add(record.id);
    }
  }

  for (const record of records) {
    if (matchedIds.has(record.id)) continue;
    const hit = scoreRecord(record, intent, "document");
    if (hit) hits.push(hit);
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, intent.limit);
}

export function matchRecordsToIntent(
  records: HistoryRecord[],
  intent: SmartSearchIntent,
): SmartSearchHit[] {
  const hits = matchRecordsToIntentPass(records, intent);

  // Si org + type ne donne rien, élargir à l'organisation seule.
  if (
    hits.length === 0 &&
    intent.organizations.length > 0 &&
    intent.documentTypes.length > 0
  ) {
    const relaxed: SmartSearchIntent = {
      ...intent,
      documentTypes: [],
    };
    return matchRecordsToIntentPass(records, relaxed).map((hit) => ({
      ...hit,
      score: Math.max(1, hit.score - 2),
    }));
  }

  return hits;
}
