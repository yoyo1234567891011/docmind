export type FeedbackCategory =
  | "bug"
  | "ux"
  | "feature"
  | "performance"
  | "other";

export type FeedbackRating = 1 | 2 | 3 | 4 | 5;

export interface FeedbackEntry {
  id: string;
  at: string;
  userId: string | null;
  email: string | null;
  category: FeedbackCategory;
  rating: FeedbackRating | null;
  message: string;
  page: string | null;
  userAgent: string | null;
  appVersion: string;
  deployEnv: string;
}

export type ErrorReportKind =
  | "bug"
  | "crash"
  | "analysis"
  | "upload"
  | "other";

export type ErrorReportSeverity = "low" | "medium" | "high";

export interface ErrorReportEntry {
  id: string;
  at: string;
  userId: string | null;
  email: string | null;
  kind: ErrorReportKind;
  severity: ErrorReportSeverity;
  message: string;
  page: string | null;
  errorCode: string | null;
  /** Message d'erreur déjà sanitizé (pas de secrets / PII brute) */
  errorDetail: string | null;
  userAgent: string | null;
  appVersion: string;
  deployEnv: string;
}

export type AppEventLevel = "info" | "warn" | "error";

export interface AppEventEntry {
  id: string;
  at: string;
  level: AppEventLevel;
  source: string;
  message: string;
  /** Métadonnées non sensibles */
  meta?: Record<string, string | number | boolean | null>;
  userId?: string | null;
}

export const FEEDBACK_CATEGORIES: FeedbackCategory[] = [
  "bug",
  "ux",
  "feature",
  "performance",
  "other",
];

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: "Bug",
  ux: "Expérience / interface",
  feature: "Idée de fonctionnalité",
  performance: "Performance",
  other: "Autre",
};

export const ERROR_REPORT_KINDS: ErrorReportKind[] = [
  "bug",
  "crash",
  "analysis",
  "upload",
  "other",
];

export const ERROR_REPORT_KIND_LABELS: Record<ErrorReportKind, string> = {
  bug: "Bug général",
  crash: "Plantage / écran blanc",
  analysis: "Problème d'analyse",
  upload: "Problème d'upload",
  other: "Autre",
};

/** Vue sanitizée d'un log d'analyse (UI bêta). */
export interface PublicAnalysisLogEntry {
  id: string;
  at: string;
  fileName: string | null;
  categoryLabel: string;
  model: string;
  durationMs: number;
  ok: boolean;
  summary: string | null;
  errorMessage: string | null;
  steps: Array<{
    task: string;
    durationMs: number;
    ok: boolean;
    note: string | null;
  }>;
}
