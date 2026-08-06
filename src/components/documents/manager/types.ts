import type {
  DocumentCategory,
  DocumentSortDirection,
  DocumentSortField,
  DocumentTag,
  FolderWithCount,
  HistoryListItem,
  RiskAssessment,
} from "@/types";

export type ManagerSidebarFilter =
  | { type: "all" }
  | { type: "favorites" }
  | { type: "folder"; id: string }
  | { type: "tag"; id: string };

export type ManagerViewMode = "list" | "board";

export interface ManagerFilters {
  search: string;
  category: DocumentCategory | "all";
  riskLevel: RiskAssessment["risk_level"] | "all";
  sortBy: DocumentSortField;
  sortDir: DocumentSortDirection;
}

export interface ManagerMeta {
  folders: FolderWithCount[];
  unfiledCount: number;
  tags: DocumentTag[];
}

export type ManagerDocument = HistoryListItem;
