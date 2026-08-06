import type { DocumentAnalysis, AnalyzeDocumentResult } from "@/types/analysis";
import type { DocumentCategory, DocumentClassification } from "@/types/document-category";
import type { ReadyReply } from "@/types/reply";
import type { RiskAssessment } from "@/types/risk";
import type { DocumentSheet } from "@/types/sheet";

export type DocumentSortField =
  | "analyzedAt"
  | "title"
  | "riskScore"
  | "fileName";

export type DocumentSortDirection = "asc" | "desc";

export interface HistoryRecord {
  id: string;
  /** Owner (Supabase auth user id) */
  userId: string;
  documentId: string;
  fileName: string;
  /** Nom affiché (renommage) — prioritaire sur analysis.title */
  displayName?: string | null;
  favorite?: boolean;
  tagIds?: string[];
  createdAt: string;
  classification: DocumentClassification;
  analysis: DocumentAnalysis;
  readyReply: ReadyReply;
  model: string;
  analyzedAt: string;
  extractedText: string;
  /** Dossier utilisateur (null = non classé) */
  folderId: string | null;
  /**
   * Provenance du classement dossier.
   * - auto : assigné depuis la catégorie IA (peut être reclassé)
   * - manual : choisi par l’utilisateur (ne pas écraser)
   */
  folderSource?: "auto" | "manual";
  /** Prompt revisions used for this analysis (if captured) */
  promptsUsed?: import("@/types/admin").PromptUsageSnapshot;
  /** Fiche structurée auto-générée après analyse */
  sheet?: DocumentSheet;
  /**
   * Progressive UX : preview (rapide) puis complete (analyse pleine).
   * Absent = analyses anciennes (traitées comme complete).
   */
  analysisPhase?: "preview" | "complete" | "failed";
  /**
   * Phase graphe mémoire (P0+) — progressive enhancement, pas d’UI P0.
   * pending → ready après dual-write Entity/Clause/Deadline.
   */
  relationsPhase?: import("@/types/memory").MemoryRelationsPhase;
  /** SHA-256 du texte extrait (fingerprint doublons P1). */
  contentHash?: string | null;
  /** SimHash 64-bit hex (near-duplicates P1). */
  simhash?: string | null;
  /** Entités canoniques liées (ids EntityStore). */
  primaryEntityIds?: string[];
  /** Horodatage dernier sync mémoire. */
  memorySyncedAt?: string | null;
}

export interface HistoryListItem {
  id: string;
  documentId: string;
  fileName: string;
  displayName: string | null;
  title: string;
  favorite: boolean;
  tagIds: string[];
  createdAt: string;
  documentType: string;
  category: DocumentCategory;
  categoryLabel: string;
  riskScore: number;
  riskLevel: RiskAssessment["risk_level"];
  analyzedAt: string;
  actionCount: number;
  replyRequired: boolean;
  needsAction: boolean;
  folderId: string | null;
}

export interface HistoryQuery {
  search?: string;
  category?: DocumentCategory | "all";
  riskLevel?: RiskAssessment["risk_level"] | "all";
  folderId?: string | "all" | "non-classes";
  tagId?: string | "all";
  favoritesOnly?: boolean;
  sortBy?: DocumentSortField;
  sortDir?: DocumentSortDirection;
}

export interface SaveHistoryInput {
  result: AnalyzeDocumentResult;
  fileName: string;
  extractedText: string;
  folderId?: string | null;
}

export interface PatchHistoryInput {
  folderId?: string | null;
  displayName?: string | null;
  fileName?: string;
  favorite?: boolean;
  tagIds?: string[];
}
