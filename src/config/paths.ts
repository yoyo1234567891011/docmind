import path from "path";

import { AppError } from "@/lib/errors";

const DATA_DIR = path.join(process.cwd(), "data");
const USERS_DIR = path.join(DATA_DIR, "users");

/** @deprecated Global path — use userHistoryDir(userId) */
export const UPLOADS_DIR = path.join(process.cwd(), "uploads");
/** @deprecated Global path — use userHistoryDir(userId) */
export const HISTORY_DIR = path.join(DATA_DIR, "history");
/** @deprecated Global path — use userFoldersFile(userId) */
export const FOLDERS_FILE = path.join(DATA_DIR, "folders.json");
/** @deprecated Global path — use userAlertsStateFile(userId) */
export const ALERTS_STATE_FILE = path.join(DATA_DIR, "alerts-state.json");

export const ADMIN_DIR = path.join(DATA_DIR, "admin");
export const ADMIN_CONFIG_FILE = path.join(ADMIN_DIR, "config.json");
export const ADMIN_PROMPTS_FILE = path.join(ADMIN_DIR, "prompts.json");
export const ADMIN_METRICS_FILE = path.join(ADMIN_DIR, "metrics.json");
/** @deprecated Global path — use userAnalysisLogsFile(userId) */
export const ANALYSIS_LOGS_FILE = path.join(ADMIN_DIR, "analysis-logs.json");

/** Données système bêta (feedback, signalements, journal applicatif) */
export const SYSTEM_DIR = path.join(DATA_DIR, "system");
export const FEEDBACK_FILE = path.join(SYSTEM_DIR, "feedback.json");
export const ERROR_REPORTS_FILE = path.join(SYSTEM_DIR, "error-reports.json");
export const APP_EVENTS_FILE = path.join(SYSTEM_DIR, "app-events.json");
/** Événements produit (P1/P2, abandon, conversion, CSAT…) */
export const PRODUCT_ANALYTICS_FILE = path.join(
  SYSTEM_DIR,
  "product-analytics.json",
);

/** Sauvegardes locales (data + uploads). */
export const BACKUPS_DIR = path.join(process.cwd(), "backups");

/** Métriques / alertes monitoring ops. */
export const MONITORING_DIR = path.join(SYSTEM_DIR, "monitoring");
export const MONITORING_EVENTS_FILE = path.join(
  MONITORING_DIR,
  "events.json",
);
export const MONITORING_ALERTS_FILE = path.join(
  MONITORING_DIR,
  "alerts.json",
);
export const MONITORING_SNAPSHOT_FILE = path.join(
  MONITORING_DIR,
  "latest-snapshot.json",
);

const SAFE_USER_ID = /^[a-zA-Z0-9_-]+$/;
/** UUID / ids générés serveur — refuse `..`, `/`, `\` */
const SAFE_RESOURCE_ID = /^[a-zA-Z0-9_-]+$/;

export function assertSafeUserId(userId: string): string {
  const id = userId.trim();
  if (!id || !SAFE_USER_ID.test(id) || id.includes("..")) {
    throw new AppError(
      "BAD_REQUEST",
      "Identifiant utilisateur invalide.",
      400,
    );
  }
  return id;
}

/**
 * Valide un id utilisé dans un chemin fichier (history, document, index…).
 * Empêche le path traversal (`../`, séparateurs, etc.).
 */
export function assertSafeResourceId(
  rawId: string,
  label = "identifiant",
): string {
  const id = rawId.trim();
  if (!id || !SAFE_RESOURCE_ID.test(id) || id.includes("..")) {
    throw new AppError("BAD_REQUEST", `${label} invalide.`, 400);
  }
  return id;
}

/**
 * Résout un chemin sous `baseDir` et refuse toute sortie du répertoire.
 */
export function resolveContainedPath(
  baseDir: string,
  ...segments: string[]
): string {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, ...segments);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  if (resolved !== base && !resolved.startsWith(prefix)) {
    throw new AppError("BAD_REQUEST", "Chemin de stockage invalide.", 400);
  }
  return resolved;
}

export function userDataDir(userId: string): string {
  return path.join(USERS_DIR, assertSafeUserId(userId));
}

/** Usage quotas mensuels par utilisateur. */
export function userUsageFile(userId: string): string {
  return path.join(userDataDir(userId), "usage.json");
}

export function userHistoryDir(userId: string): string {
  return path.join(userDataDir(userId), "history");
}

export function userUploadsDir(userId: string): string {
  return path.join(process.cwd(), "uploads", assertSafeUserId(userId));
}

export function userFoldersFile(userId: string): string {
  return path.join(userDataDir(userId), "folders.json");
}

export function userAlertsStateFile(userId: string): string {
  return path.join(userDataDir(userId), "alerts-state.json");
}

export function userAnalysisLogsFile(userId: string): string {
  return path.join(userDataDir(userId), "analysis-logs.json");
}

export function userTagsFile(userId: string): string {
  return path.join(userDataDir(userId), "tags.json");
}

export function userNotificationPreferencesFile(userId: string): string {
  return path.join(userDataDir(userId), "notification-preferences.json");
}

export function userNotificationOutboxFile(userId: string): string {
  return path.join(userDataDir(userId), "notification-outbox.json");
}

export function userSearchIndexDir(userId: string): string {
  return path.join(userDataDir(userId), "search-index");
}

/** Cache d’analyse isolé par utilisateur (pas de fuite inter-comptes). */
export function userAnalysisCacheDir(userId: string): string {
  return path.join(userDataDir(userId), "analysis-cache");
}

/** Abonnement / facturation Stripe (état local isolé). */
export function userSubscriptionFile(userId: string): string {
  return path.join(userDataDir(userId), "subscription.json");
}

export function userSearchIndexFile(userId: string, historyId: string): string {
  const safeId = assertSafeResourceId(historyId, "historyId");
  return resolveContainedPath(userSearchIndexDir(userId), `${safeId}.json`);
}

export function userHistoryRecordPath(userId: string, historyId: string): string {
  const safeId = assertSafeResourceId(historyId, "historyId");
  return resolveContainedPath(userHistoryDir(userId), `${safeId}.json`);
}

export function userPdfPath(userId: string, documentId: string): string {
  const safeId = assertSafeResourceId(documentId, "documentId");
  return resolveContainedPath(userUploadsDir(userId), `${safeId}.pdf`);
}

/** Mémoire documentaire (graphe P0+) — isolée par utilisateur. */
export function userMemoryDir(userId: string): string {
  return path.join(userDataDir(userId), "memory");
}

export function userEntitiesFile(userId: string): string {
  return path.join(userMemoryDir(userId), "entities.jsonl");
}

export function userClausesDir(userId: string): string {
  return path.join(userMemoryDir(userId), "clauses");
}

export function userDeadlinesDir(userId: string): string {
  return path.join(userMemoryDir(userId), "deadlines");
}

export function userRelationsDir(userId: string): string {
  return path.join(userMemoryDir(userId), "relations");
}

export function userMemoryDocumentsDir(userId: string): string {
  return path.join(userMemoryDir(userId), "documents");
}

export function userMemoryIndexesDir(userId: string): string {
  return path.join(userMemoryDir(userId), "indexes");
}

export function userClausesFile(userId: string, documentId: string): string {
  const safeId = assertSafeResourceId(documentId, "documentId");
  return resolveContainedPath(userClausesDir(userId), `${safeId}.json`);
}

export function userDeadlinesFile(userId: string, documentId: string): string {
  const safeId = assertSafeResourceId(documentId, "documentId");
  return resolveContainedPath(userDeadlinesDir(userId), `${safeId}.json`);
}

export function userRelationsFile(userId: string, documentId: string): string {
  const safeId = assertSafeResourceId(documentId, "documentId");
  return resolveContainedPath(userRelationsDir(userId), `${safeId}.json`);
}

export function userMemoryDocumentFile(
  userId: string,
  documentId: string,
): string {
  const safeId = assertSafeResourceId(documentId, "documentId");
  return resolveContainedPath(userMemoryDocumentsDir(userId), `${safeId}.json`);
}
