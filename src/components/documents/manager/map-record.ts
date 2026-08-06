import type { HistoryListItem, HistoryRecord } from "@/types";

/** Met à jour un item de liste après un PATCH historique. */
export function mapRecordToListItem(
  record: HistoryRecord,
  previous?: HistoryListItem,
): HistoryListItem {
  return {
    id: record.id,
    documentId: record.documentId,
    fileName: record.fileName,
    displayName: record.displayName ?? null,
    title:
      record.displayName?.trim() ||
      record.analysis.title ||
      record.fileName,
    favorite: Boolean(record.favorite),
    tagIds: record.tagIds ?? [],
    createdAt: previous?.createdAt ?? record.createdAt,
    documentType:
      previous?.documentType ??
      record.analysis.document_type ??
      record.classification.label,
    category: record.classification.category,
    categoryLabel: record.classification.label,
    riskScore: record.analysis.risk_score,
    riskLevel: record.analysis.risk_level,
    analyzedAt: record.analyzedAt,
    actionCount: previous?.actionCount ?? record.analysis.actions?.length ?? 0,
    replyRequired:
      previous?.replyRequired ?? Boolean(record.readyReply?.required),
    needsAction:
      previous?.needsAction ??
      Boolean(record.readyReply?.required || record.analysis.actions?.length),
    folderId: record.folderId,
  };
}
