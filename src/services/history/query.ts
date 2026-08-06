import type {
  DocumentSortDirection,
  DocumentSortField,
  HistoryListItem,
  HistoryQuery,
  HistoryRecord,
} from "@/types";
import { UNFILED_FOLDER_ID } from "@/types";

export function toHistoryListItem(record: HistoryRecord): HistoryListItem {
  const actionCount = record.analysis.actions.length;
  const replyRequired = Boolean(record.readyReply?.required);
  const highRisk =
    record.analysis.risk_level === "eleve" ||
    record.analysis.risk_level === "critique";
  const displayName = record.displayName?.trim() || null;

  return {
    id: record.id,
    documentId: record.documentId,
    fileName: record.fileName,
    displayName,
    title: displayName || record.analysis.title || record.fileName,
    favorite: Boolean(record.favorite),
    tagIds: Array.isArray(record.tagIds) ? record.tagIds : [],
    createdAt: record.createdAt,
    documentType: record.analysis.document_type || record.classification.label,
    category: record.classification.category,
    categoryLabel: record.classification.label,
    riskScore: record.analysis.risk_score,
    riskLevel: record.analysis.risk_level,
    analyzedAt: record.analyzedAt,
    actionCount,
    replyRequired,
    needsAction: actionCount > 0 || replyRequired || highRisk,
    folderId: record.folderId ?? null,
  };
}

function sortItems(
  items: HistoryListItem[],
  sortBy: DocumentSortField = "analyzedAt",
  sortDir: DocumentSortDirection = "desc",
): HistoryListItem[] {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case "title":
        cmp = a.title.localeCompare(b.title, "fr", { sensitivity: "base" });
        break;
      case "fileName":
        cmp = a.fileName.localeCompare(b.fileName, "fr", {
          sensitivity: "base",
        });
        break;
      case "riskScore":
        cmp = a.riskScore - b.riskScore;
        break;
      case "analyzedAt":
      default:
        cmp =
          new Date(a.analyzedAt).getTime() - new Date(b.analyzedAt).getTime();
        break;
    }
    if (cmp === 0) {
      // Favorites first as soft secondary order
      cmp = Number(b.favorite) - Number(a.favorite);
    }
    return cmp * dir;
  });
}

export function filterHistoryRecords(
  records: HistoryRecord[],
  query: HistoryQuery,
): HistoryListItem[] {
  const search = query.search?.trim().toLowerCase() ?? "";
  const category = query.category ?? "all";
  const riskLevel = query.riskLevel ?? "all";
  const folderId = query.folderId ?? "all";
  const tagId = query.tagId ?? "all";
  const favoritesOnly = Boolean(query.favoritesOnly);

  const filtered = records
    .filter((record) => {
      if (favoritesOnly && !record.favorite) return false;

      if (category !== "all" && record.classification.category !== category) {
        return false;
      }

      if (riskLevel !== "all" && record.analysis.risk_level !== riskLevel) {
        return false;
      }

      if (folderId !== "all") {
        if (folderId === UNFILED_FOLDER_ID) {
          if (record.folderId) return false;
        } else if (record.folderId !== folderId) {
          return false;
        }
      }

      if (tagId !== "all") {
        const tags = Array.isArray(record.tagIds) ? record.tagIds : [];
        if (!tags.includes(tagId)) return false;
      }

      if (!search) return true;

      const haystack = [
        record.fileName,
        record.displayName,
        record.analysis.title,
        record.analysis.document_type,
        record.classification.label,
        ...record.analysis.people,
        ...record.analysis.organizations,
        ...record.analysis.important_points,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(search);
    })
    .map(toHistoryListItem);

  return sortItems(filtered, query.sortBy, query.sortDir);
}
