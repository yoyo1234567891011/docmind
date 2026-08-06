import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import {
  filterHistoryRecords,
  listHistoryRecords,
} from "@/services/history";
import {
  DOCUMENT_CATEGORIES,
  UNFILED_FOLDER_ID,
  type DocumentCategory,
  type DocumentSortDirection,
  type DocumentSortField,
  type HistoryQuery,
  type RiskAssessment,
} from "@/types";

export const runtime = "nodejs";

const RISK_LEVELS = ["faible", "modere", "eleve", "critique"] as const;
const SORT_FIELDS: DocumentSortField[] = [
  "analyzedAt",
  "title",
  "riskScore",
  "fileName",
];

function parseCategory(
  value: string | null,
): HistoryQuery["category"] {
  if (!value || value === "all") return "all";
  if ((DOCUMENT_CATEGORIES as readonly string[]).includes(value)) {
    return value as DocumentCategory;
  }
  return "all";
}

function parseRiskLevel(
  value: string | null,
): HistoryQuery["riskLevel"] {
  if (!value || value === "all") return "all";
  if ((RISK_LEVELS as readonly string[]).includes(value)) {
    return value as RiskAssessment["risk_level"];
  }
  return "all";
}

function parseFolderId(
  value: string | null,
): HistoryQuery["folderId"] {
  if (!value || value === "all") return "all";
  if (value === UNFILED_FOLDER_ID) return UNFILED_FOLDER_ID;
  return value;
}

/**
 * GET /api/history?...
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);

    const sortByRaw = searchParams.get("sortBy");
    const sortDirRaw = searchParams.get("sortDir");

    const query: HistoryQuery = {
      search: searchParams.get("search") ?? "",
      category: parseCategory(searchParams.get("category")),
      riskLevel: parseRiskLevel(searchParams.get("riskLevel")),
      folderId: parseFolderId(searchParams.get("folderId")),
      tagId: searchParams.get("tagId") ?? "all",
      favoritesOnly: searchParams.get("favorites") === "1",
      sortBy:
        sortByRaw && (SORT_FIELDS as string[]).includes(sortByRaw)
          ? (sortByRaw as DocumentSortField)
          : "analyzedAt",
      sortDir:
        sortDirRaw === "asc" || sortDirRaw === "desc"
          ? (sortDirRaw as DocumentSortDirection)
          : "desc",
    };

    const records = await listHistoryRecords(user.id);
    const items = filterHistoryRecords(records, query);

    return apiSuccess({
      items,
      total: items.length,
    });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
