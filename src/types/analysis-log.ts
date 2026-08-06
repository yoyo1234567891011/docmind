import type { PromptUsageSnapshot } from "@/types/admin";
import type { DocumentCategory } from "@/types/document-category";

export interface AnalysisLogTokens {
  prompt: number;
  completion: number;
  total: number;
}

export interface AnalysisLogStep {
  task: string;
  model: string;
  durationMs: number;
  tokens: AnalysisLogTokens;
  ok: boolean;
  error?: string;
}

export interface AnalysisLogResultSummary {
  title: string;
  documentType: string;
  riskScore: number;
  riskLevel: string;
  summary: string;
  replyRequired: boolean;
  actionCount: number;
  deadlineCount: number;
}

export interface AnalysisLogEntry {
  id: string;
  at: string;
  documentId: string;
  historyId?: string | null;
  fileName?: string;
  category: DocumentCategory | string;
  categoryLabel: string;
  /** Primary model (analyze task) */
  model: string;
  promptsUsed: PromptUsageSnapshot;
  durationMs: number;
  tokens: AnalysisLogTokens;
  steps: AnalysisLogStep[];
  result: AnalysisLogResultSummary | null;
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface AnalysisLogsFile {
  entries: AnalysisLogEntry[];
}
