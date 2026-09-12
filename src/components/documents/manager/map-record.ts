import type { HistoryListItem, HistoryRecord } from "@/types";
import { resolveDisplayCategoryLabel } from "@/lib/dashboard-display";

/** Met à jour un item de liste après un PATCH historique. */
export function mapRecordToListItem(
  record: HistoryRecord,
  previous?: HistoryListItem,
): HistoryListItem {
  const title =
    record.displayName?.trim() ||
    record.analysis.title ||
    record.fileName;
  const documentType =
    previous?.documentType ??
    record.analysis.document_type ??
    record.classification.label;
  return {
    id: record.id,
    documentId: record.documentId,
    fileName: record.fileName,
    displayName: record.displayName ?? null,
    title,
    favorite: Boolean(record.favorite),
    tagIds: record.tagIds ?? [],
    createdAt: previous?.createdAt ?? record.createdAt,
    documentType,
    category: record.classification.category,
    categoryLabel: resolveDisplayCategoryLabel({
      category: record.classification.category,
      categoryLabel: record.classification.label,
      title,
      documentType,
    }),
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
    analysisPhase: record.analysisPhase ?? previous?.analysisPhase,
    contentHash: record.contentHash ?? previous?.contentHash ?? null,
  };
}
