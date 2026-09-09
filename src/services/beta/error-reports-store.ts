import { randomUUID } from "crypto";

import { usePersistentStorage } from "@/config/persistence";
import { ERROR_REPORTS_FILE } from "@/config/paths";
import { getAppVersion, getDeployEnv } from "@/config/runtime";
import { sanitizeErrorMessage, sanitizeUserText } from "@/lib/sanitize";
import {
  pgAnonymizeErrorReportsForUser,
  pgInsertErrorReport,
  pgListErrorReports,
} from "@/services/persistence/error-reports-pg";
import {
  appendJsonArrayEntry,
  readJsonArrayFile,
  writeJsonArrayFile,
} from "@/services/beta/json-store";
import { appendAppEvent } from "@/services/beta/app-events";
import type {
  ErrorReportEntry,
  ErrorReportKind,
  ErrorReportSeverity,
} from "@/types/beta";
import { ERROR_REPORT_KINDS } from "@/types/beta";

export interface CreateErrorReportInput {
  userId?: string | null;
  email?: string | null;
  kind: ErrorReportKind;
  severity?: ErrorReportSeverity;
  message: string;
  page?: string | null;
  errorCode?: string | null;
  errorDetail?: string | null;
  userAgent?: string | null;
}

export function isErrorReportKind(value: string): value is ErrorReportKind {
  return (ERROR_REPORT_KINDS as string[]).includes(value);
}

export async function createErrorReport(
  input: CreateErrorReportInput,
): Promise<ErrorReportEntry> {
  const message = sanitizeUserText(input.message, 2_000);
  if (message.length < 5) {
    throw new Error("Message trop court");
  }

  const entry: ErrorReportEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    userId: input.userId ?? null,
    email: input.email ? sanitizeUserText(input.email, 120) : null,
    kind: input.kind,
    severity: input.severity ?? "medium",
    message,
    page: input.page ? sanitizeUserText(input.page, 300) : null,
    errorCode: input.errorCode
      ? sanitizeUserText(input.errorCode, 80)
      : null,
    errorDetail: input.errorDetail
      ? sanitizeErrorMessage(input.errorDetail)
      : null,
    userAgent: input.userAgent
      ? sanitizeUserText(input.userAgent, 240)
      : null,
    appVersion: getAppVersion(),
    deployEnv: getDeployEnv(),
  };

  if (usePersistentStorage()) {
    await pgInsertErrorReport(entry);
  } else {
    await appendJsonArrayEntry(ERROR_REPORTS_FILE, entry);
  }
  try {
    await appendAppEvent({
      level: entry.severity === "high" ? "error" : "warn",
      source: "error-report",
      message: `Signalement ${entry.kind}: ${entry.message.slice(0, 120)}`,
      userId: entry.userId,
      meta: {
        reportId: entry.id,
        severity: entry.severity,
        errorCode: entry.errorCode,
      },
    });
  } catch {
    // Signalement déjà persisté ; le journal FS ne doit pas bloquer l'envoi.
  }

  return entry;
}

export async function listErrorReports(
  limit = 100,
): Promise<ErrorReportEntry[]> {
  const capped = Math.min(Math.max(limit, 1), 500);
  if (usePersistentStorage()) {
    return pgListErrorReports(capped);
  }
  const entries = await readJsonArrayFile<ErrorReportEntry>(ERROR_REPORTS_FILE);
  return entries.slice(0, capped);
}

/** RGPD Art. 17 — retire userId/email des signalements. */
export async function anonymizeErrorReportsForUser(
  userId: string,
): Promise<{ updated: number }> {
  if (usePersistentStorage()) {
    const updated = await pgAnonymizeErrorReportsForUser(userId);
    return { updated };
  }
  const entries = await readJsonArrayFile<ErrorReportEntry>(ERROR_REPORTS_FILE);
  let updated = 0;
  for (const entry of entries) {
    if (entry.userId === userId) {
      entry.userId = null;
      entry.email = null;
      updated += 1;
    }
  }
  if (updated > 0) {
    await writeJsonArrayFile(ERROR_REPORTS_FILE, entries);
  }
  return { updated };
}
