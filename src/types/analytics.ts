/** Événements produit DocMind (instrumentation). */

export const ANALYTICS_EVENT_NAMES = [
  /* Funnel analyse */
  "analysis.started",
  "analysis.p1",
  "analysis.p2",
  "analysis.completed",
  "analysis.error",
  "analysis.fallback",
  "analysis.abandon",
  "extraction.completed",
  "satisfaction.rated",
  /* Acquisition / session */
  "page.view",
  "auth.signup",
  "auth.login",
  /* Billing */
  "billing.checkout_started",
  "billing.converted",
  "billing.renewed",
  "billing.cancel_requested",
  "billing.refunded",
  "billing.churned",
  /* Compte / RGPD */
  "account.deleted",
  "account.exported",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

export type AnalyticsMeta = Record<
  string,
  string | number | boolean | null | undefined
>;

export interface AnalyticsEvent {
  id: string;
  at: string;
  name: AnalyticsEventName;
  userId?: string | null;
  meta?: AnalyticsMeta;
}

export interface AnalyticsFile {
  version: 1;
  events: AnalyticsEvent[];
}

export interface AnalyticsTimingSummary {
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
}

export interface AnalyticsProductSummary {
  windowDays: number;
  totalEvents: number;
  analysesStarted: number;
  analysesCompleted: number;
  analysesErrored: number;
  fallbackCount: number;
  fallbackRate: number;
  abandonCount: number;
  abandonRate: number;
  pageViews: number;
  signups: number;
  logins: number;
  p1: AnalyticsTimingSummary;
  p2: AnalyticsTimingSummary;
  analysisTotal: AnalyticsTimingSummary;
  extraction: AnalyticsTimingSummary;
  /** Toujours 0 tant que l’OCR n’est pas branché — champ réservé. */
  ocr: AnalyticsTimingSummary;
  satisfaction: {
    ratings: number;
    average: number | null;
    distribution: Record<string, number>;
  };
  topDocumentTypes: Array<{ label: string; count: number }>;
  conversion: {
    checkoutStarted: number;
    converted: number;
    renewed: number;
    cancelRequested: number;
    refunded: number;
    churned: number;
    freeToPremiumRate: number;
  };
  account: {
    deleted: number;
    exported: number;
  };
  cost: {
    /** Estimation EUR (config GPU/heure + tokens). */
    avgPerAnalysisEur: number;
    totalEstimatedEur: number;
    analysesWithCost: number;
  };
  recentErrors: Array<{
    at: string;
    message: string;
    code?: string;
    phase?: string;
  }>;
}

/** Événements acceptés via POST /api/analytics (client). */
export const CLIENT_ANALYTICS_EVENT_NAMES = [
  "page.view",
  "auth.signup",
  "auth.login",
  "analysis.abandon",
  "satisfaction.rated",
] as const;

export type ClientAnalyticsEventName =
  (typeof CLIENT_ANALYTICS_EVENT_NAMES)[number];
