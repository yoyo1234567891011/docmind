import type { DocumentCategory } from "@/types/document-category";
import type { HistoryListItem } from "@/types/history";
import type { RiskAssessment } from "@/types/risk";

export type AmountOperator = "gt" | "gte" | "lt" | "lte" | "eq" | "between";

export type SmartSearchDateField =
  | "any"
  | "deadline"
  | "document"
  | "analyzed";

export interface SmartSearchAmountFilter {
  operator: AmountOperator;
  value: number;
  valueMax?: number;
}

export interface SmartSearchDateFilter {
  field: SmartSearchDateField;
  /** Inclusive ISO date YYYY-MM-DD */
  from?: string;
  /** Inclusive ISO date YYYY-MM-DD */
  to?: string;
  /** Convenience: match deadlines/dates in a calendar year */
  year?: number;
}

/**
 * Structured intent produced from a natural-language query.
 * Extensible: add fields without breaking older clients.
 */
export interface SmartSearchIntent {
  rawQuery: string;
  interpretedAs: string;
  keywords: string[];
  organizations: string[];
  people: string[];
  documentTypes: string[];
  categories: DocumentCategory[];
  amount?: SmartSearchAmountFilter | null;
  date?: SmartSearchDateFilter | null;
  riskLevels?: Array<RiskAssessment["risk_level"]>;
  folderId?: string | null;
  needsAction?: boolean | null;
  limit: number;
  source: "llm" | "heuristic" | "hybrid";
}

export interface SmartSearchRequest {
  query: string;
  /** Optional hard filters applied after intent matching */
  folderId?: string | "all";
  limit?: number;
}

export interface SmartSearchMatchReason {
  code:
    | "keyword"
    | "organization"
    | "person"
    | "document_type"
    | "category"
    | "amount"
    | "date"
    | "deadline"
    | "risk"
    | "folder"
    | "action"
    | "sheet"
    | "full_text"
    | "semantic";
  label: string;
}

/** Où le document a été trouvé en priorité. */
export type SmartSearchMatchSource = "sheet" | "document";

export interface SmartSearchHit {
  item: HistoryListItem;
  score: number;
  reasons: SmartSearchMatchReason[];
  highlights: string[];
  /** Fiche structurée d’abord ; texte complet seulement en secours. */
  matchedOn: SmartSearchMatchSource;
}

export interface SmartSearchResult {
  query: string;
  intent: SmartSearchIntent;
  hits: SmartSearchHit[];
  total: number;
  tookMs: number;
  /** Combien de hits viennent des fiches vs du texte complet. */
  stats: {
    fromSheets: number;
    fromDocuments: number;
  };
}

export const EMPTY_SMART_SEARCH_INTENT: Omit<
  SmartSearchIntent,
  "rawQuery" | "interpretedAs" | "source"
> = {
  keywords: [],
  organizations: [],
  people: [],
  documentTypes: [],
  categories: [],
  amount: null,
  date: null,
  riskLevels: [],
  folderId: undefined,
  needsAction: null,
  limit: 20,
};
