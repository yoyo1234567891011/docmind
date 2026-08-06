/**
 * DocMind configuration barrel.
 *
 * ▶ Edit all app settings in: `src/config/docmind.ts`
 */
export {
  docmindConfig,
  getActiveModelProfile,
  getActiveModelProfileId,
  resolveProfileChatModel,
  resolveProfileTemperature,
  resolveProfileMaxTokens,
  MODEL_PROFILE_IDS,
  MODEL_PROFILES,
  ACTIVE_MODEL_PROFILE,
  DOCUMENT_CATEGORY_IDS,
  type DocmindConfig,
  type ModelProfileId,
  type ChatTaskId,
  type PromptKey,
  type DocumentCategoryId,
  type ModelProfile,
} from "./docmind";

export { siteConfig } from "./site";
export {
  ACCEPTED_DOCUMENT_MIME_TYPES,
  MAX_UPLOAD_SIZE_BYTES,
  ANALYSIS_JSON_SCHEMA,
  ANALYSIS_SECTIONS,
} from "./constants";
export {
  UPLOADS_DIR,
  HISTORY_DIR,
  FOLDERS_FILE,
  ALERTS_STATE_FILE,
  ADMIN_DIR,
  ADMIN_CONFIG_FILE,
  ADMIN_PROMPTS_FILE,
  ADMIN_METRICS_FILE,
  ANALYSIS_LOGS_FILE,
  userDataDir,
  userHistoryDir,
  userUploadsDir,
  userFoldersFile,
  userAlertsStateFile,
  userAnalysisLogsFile,
  assertSafeUserId,
} from "./paths";
export { getModelProfile } from "./ollama-models";
