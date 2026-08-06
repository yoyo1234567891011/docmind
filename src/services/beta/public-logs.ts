import { friendlyErrorMessage, sanitizeUserText } from "@/lib/sanitize";
import type { AnalysisLogEntry, AnalysisLogStep } from "@/types";
import type { PublicAnalysisLogEntry } from "@/types/beta";

export type { PublicAnalysisLogEntry };

function publicStep(step: AnalysisLogStep) {
  return {
    task: step.task,
    durationMs: step.durationMs,
    ok: step.ok,
    note: step.error ? sanitizeUserText(step.error, 160) : null,
  };
}

export function toPublicAnalysisLog(
  entry: AnalysisLogEntry,
): PublicAnalysisLogEntry {
  const friendly = entry.ok
    ? null
    : friendlyErrorMessage(entry.errorCode, entry.errorMessage);

  return {
    id: entry.id,
    at: entry.at,
    fileName: entry.fileName
      ? sanitizeUserText(entry.fileName, 160)
      : null,
    categoryLabel: entry.categoryLabel || entry.category,
    model: entry.model || "—",
    durationMs: entry.durationMs,
    ok: entry.ok,
    summary: entry.result?.summary
      ? sanitizeUserText(entry.result.summary, 280)
      : entry.result?.title
        ? sanitizeUserText(entry.result.title, 120)
        : null,
    errorMessage: friendly,
    steps: (entry.steps ?? []).map(publicStep),
  };
}
