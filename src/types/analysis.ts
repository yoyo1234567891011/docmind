import type { CitedConclusion } from "@/types/citation";
import type { DocumentClassification } from "@/types/document-category";
import type { ReadyReply } from "@/types/reply";
import type { RiskAssessment, RiskFinding } from "@/types/risk";
import type { PromptUsageSnapshot } from "@/types/admin";
import type { DocumentSheet } from "@/types/sheet";

export interface DocumentAnalysis extends RiskAssessment {
  document_type: string;
  title: string;
  summary: string;
  date: string;
  dates: string[];
  people: string[];
  organizations: string[];
  amounts: string[];
  deadlines: string[];
  important_points: string[];
  /** Points importants avec citation obligatoire */
  important_point_findings?: CitedConclusion[];
  risks: string[];
  actions: string[];
  /** Risques structurés (raisonnement) — absents sur anciennes analyses */
  risk_findings?: RiskFinding[];
}

export interface AnalyzeDocumentRequest {
  /** Owner — scopes analysis logs */
  userId: string;
  documentId: string;
  text: string;
  /** Texte par page (ordre = page 1..n) */
  pages?: string[];
  fileName?: string;
  skipReadyReply?: boolean;
  /**
   * Si une analyse du même document est déjà en cours :
   * - `wait` (défaut) : attendre sa fin et renvoyer le même résultat
   * - `status` : retourner immédiatement ANALYSIS_IN_PROGRESS (pas de 2ᵉ LLM)
   */
  onInFlight?: "wait" | "status";
  /**
   * Exécuté uniquement par le leader du single-flight (ex. consumeQuota).
   * Les waiters coalescés ne l’appellent pas.
   */
  beforeLeaderRun?: () => Promise<void>;
}

export interface AnalyzeDocumentResult {
  documentId: string;
  historyId?: string;
  classification: DocumentClassification;
  analysis: DocumentAnalysis;
  readyReply: ReadyReply;
  model: string;
  analyzedAt: string;
  /** Prompt revisions active during this analysis */
  promptsUsed: PromptUsageSnapshot;
  /** Fiche structurée générée à l’enregistrement */
  sheet?: DocumentSheet;
  /** true si ce résultat vient d’une analyse déjà en cours (single-flight) */
  coalescedFromInFlight?: boolean;
  /**
   * Progressive UX :
   * - preview = extraction locale + résumé rapide (affichage immédiat)
   * - complete = analyse juridique pleine (arrière-plan)
   */
  phase?: "preview" | "complete";
  /** Origine du résultat P2 — utile analytics / fallback. */
  resultSource?: "agents" | "salvage" | "cache";
  /** Durée totale pipeline (ms), si mesurée. */
  durationMs?: number;
  /** Tokens cumulés (si disponibles). */
  totalTokens?: number;
}
