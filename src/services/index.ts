export { extractTextFromPdf } from "@/services/pdf";
export {
  loadKnowledgeCatalog,
  selectKnowledgeForDocument,
  getKnowledgeRoot,
} from "@/services/knowledge";
export {
  generateWithOllama,
  sendTextToOllama,
  generateForTask,
} from "@/ai/models";
export type {
  OllamaGenerateOptions,
  OllamaGenerateRequest,
  OllamaGenerateResponse,
} from "@/ai/models";
export {
  analyzeDocumentText,
  classifyDocumentText,
} from "@/ai/pipelines";
export { uploadPdfDocument } from "@/services/documents";
export { savePdfToUploads } from "@/services/storage";
export type { StoredFile } from "@/services/storage";
export {
  extractDocumentEntities,
  extractAmounts,
  extractDates,
  extractDeadlines,
} from "@/ai/extraction";
export type { ExtractedEntities } from "@/ai/extraction";
export {
  assessDocumentRisk,
  buildLegalRiskFindings,
  RISK_CRITERIA,
} from "@/ai/scoring";
export {
  saveHistoryRecord,
  getHistoryRecord,
  listHistoryRecords,
  deleteHistoryRecord,
  filterHistoryRecords,
} from "@/services/history";
export {
  generateReadyReply,
  assessReplyNeed,
  suggestLetterType,
  buildFallbackLetter,
  draftLetterForHistory,
} from "@/services/reply";
export { runSmartSearch } from "@/services/search";
export {
  ensureUserWorkspace,
  getUserAccountStats,
} from "@/services/auth";
export { listDocumentAlerts } from "@/services/alerts";
export {
  scheduleMemoryDualWrite,
  runMemoryDualWrite,
  upsertMemoryFromHistoryRecord,
  migrateUserHistoryToMemory,
  listEntities,
  listRelationsForDoc,
} from "@/services/memory";
export {
  BILLING_PLANS,
  getBillingOverview,
  getUserEntitlements,
  hasEntitlement,
  requireEntitlement,
  createPremiumCheckoutSession,
  createBillingPortalSession,
  cancelPremiumSubscription,
  resumePremiumSubscription,
} from "@/services/billing";
