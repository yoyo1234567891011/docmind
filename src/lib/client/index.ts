export { uploadPdf } from "./upload-pdf";
export { analyzeDocument } from "./analyze-document";
export {
  fetchAnalysisJob,
  fetchAnalysisJobByHistory,
} from "./analysis-jobs";
export type { AnalysisJobStatusPayload } from "./analysis-jobs";
export {
  fetchHistory,
  fetchHistoryRecord,
  deleteHistoryItem,
  patchHistoryItem,
  moveHistoryToFolder,
  fetchFolders,
  createFolder,
  fetchTags,
  createTag,
  deleteTag,
  documentPdfUrl,
} from "./history";
export { smartSearch } from "./search";
export {
  readRecentSearches,
  recordRecentSearch,
  type RecentSearch,
} from "./recent-searches";
export {
  fetchAlerts,
  markAlertsAsRead,
  dismissAlerts,
  markAllAlertsAsRead,
} from "./alerts";
export {
  fetchNotificationPreferences,
  patchNotificationPreferences,
} from "./notifications";
export { draftLetter, fetchLetterSuggestion } from "./letters";
export type { DraftLetterResponse } from "./letters";
export { fetchMe, invalidateMeCache } from "./me";
export type { MeResponse, MeUser } from "./me";
export { deleteAccount, downloadAccountExport } from "./account";
export {
  fetchDocumentRelations,
  applyDocumentRelationAction,
} from "./relations";
export {
  fetchDocumentTimeline,
  fetchCounterparties,
} from "./memory-timeline";
export {
  fetchInsightsOverview,
  fetchSubscriptions,
  fetchFinanceInsight,
  fetchSavings,
  fetchDigest,
  fetchLetterIntents,
  fetchEntityTimeline,
} from "./insights";
export type {
  RelationsUiPayload,
  RelationListItem,
  RelationUiAction,
} from "./relations";
export { fetchQuotas } from "./quotas";
export type { QuotaStatus } from "./quotas";
export { ClientApiError, isQuotaExceededError } from "./api-error";
export { trackClientAnalytics } from "./analytics";
export {
  fetchBilling,
  syncBilling,
  startPlanCheckout,
  startPremiumCheckout,
  openBillingPortal,
  cancelSubscription,
  resumeSubscription,
} from "./billing";
export type { BillingApiResponse } from "./billing";
export {
  fetchAdminDashboard,
  patchAdminConfig,
  saveAdminPrompt,
  rollbackAdminPrompt,
  deleteAdminPrompt,
  compareAdminPrompts,
  reanalyzeAdminDocument,
  fetchAdminMonitoring,
  runAdminMonitoringCheck,
  fetchAdminProduction,
  fetchAdminOverview,
} from "./admin";
export type {
  AdminDashboardData,
  AdminMonitoringSnapshot,
  AdminMonitoringAlert,
  ProductionDashboard,
} from "./admin";
export type { AdminPlatformOverview } from "@/types/admin-platform";
export { fetchAnalysisLogs } from "./logs";
export {
  submitFeedback,
  submitErrorReport,
  buildReportHref,
} from "./beta";
