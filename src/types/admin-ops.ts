import type { BillingPlanId, BillingSubscriptionStatus } from "@/types/billing";
import type { AnalysisJobStatus } from "@/services/analysis-jobs/types";

/** Job exposé à l’admin — jamais de pages / extract PDF. */
export type AdminJobRow = {
  id: string;
  userId: string;
  userEmail: string | null;
  documentId: string;
  historyId: string;
  fileName: string;
  status: AnalysisJobStatus;
  attempts: number;
  lastError: string | null;
  ageMs: number;
  stuck: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  leaseExpiresAt: string | null;
  durationMs: number | null;
};

export type AdminJobsListResult = {
  at: string;
  stuckThresholdMs: number;
  counts: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    stuck: number;
  };
  jobs: AdminJobRow[];
};

export type AdminQuotaMetricSnapshot = {
  metric: "analyze" | "search" | "letter" | "upload";
  used: number;
  limit: number;
  remaining: number;
};

export type AdminUserListItem = {
  userId: string;
  email: string | null;
  planStored: BillingPlanId;
  planEffective: BillingPlanId;
  status: BillingSubscriptionStatus;
  currentPeriodEnd: string | null;
  pendingPlan: string | null;
  pendingPlanEffectiveAt: string | null;
  cancelAtPeriodEnd: boolean;
  quotasMonth: string;
  analyze: AdminQuotaMetricSnapshot;
  search: AdminQuotaMetricSnapshot;
  letter: AdminQuotaMetricSnapshot;
  updatedAt: string | null;
};

export type AdminUserDetail = AdminUserListItem & {
  createdAt: string | null;
  hasStripeCustomer: boolean;
  hasStripeSubscription: boolean;
  recentJobs: AdminJobRow[];
};

export type AdminUsersListResult = {
  at: string;
  total: number;
  users: AdminUserListItem[];
};

export type AdminBillingByPlan = {
  plan: BillingPlanId;
  count: number;
  effectiveFreeWhilePastDue: number;
};

export type AdminBillingDetail = {
  at: string;
  stripeMode: "test" | "live" | "unconfigured";
  webhookConfigured: boolean;
  source: "postgres" | "filesystem" | "none";
  byPlan: AdminBillingByPlan[];
  pastDue: number;
  cancelAtPeriodEnd: number;
  paidActiveEffective: number;
  freeEffective: number;
  /**
   * Somme prix catalogue des plans effectifs payants.
   * null en mode Stripe test / unconfigured (pas de MRR inventé).
   */
  mrrEur: number | null;
  mrrSource: "catalog_live" | "hidden_test" | "hidden_unconfigured";
};

export type AdminOverviewAlert = {
  id: string;
  severity: "info" | "warning" | "critical";
  code: string;
  message: string;
};

export type AdminActionLogEntry = {
  id: string;
  at: string;
  action: string;
  adminUserId: string;
  targetUserId?: string | null;
  targetEmail?: string | null;
  ok: boolean;
  detail?: string | null;
};
