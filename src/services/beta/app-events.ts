import { randomUUID } from "crypto";

import { canUseLocalFilesystem } from "@/config/persistence";
import { APP_EVENTS_FILE } from "@/config/paths";
import { sanitizeUserText } from "@/lib/sanitize";
import {
  appendJsonArrayEntry,
  readJsonArrayFile,
  writeJsonArrayFile,
} from "@/services/beta/json-store";
import type { AppEventEntry, AppEventLevel } from "@/types/beta";

export interface AppendAppEventInput {
  level: AppEventLevel;
  source: string;
  message: string;
  userId?: string | null;
  meta?: Record<string, string | number | boolean | null>;
}

function sanitizeMeta(
  meta?: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> | undefined {
  if (!meta) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === "string") {
      out[sanitizeUserText(key, 40)] = sanitizeUserText(value, 200);
    } else {
      out[sanitizeUserText(key, 40)] = value;
    }
  }
  return out;
}

export async function appendAppEvent(
  input: AppendAppEventInput,
): Promise<AppEventEntry> {
  const entry: AppEventEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    level: input.level,
    source: sanitizeUserText(input.source, 60),
    message: sanitizeUserText(input.message, 500),
    meta: sanitizeMeta(input.meta),
    userId: input.userId ?? null,
  };

  if (canUseLocalFilesystem()) {
    await appendJsonArrayEntry(APP_EVENTS_FILE, entry, 5_000);
  }
  return entry;
}

export async function listAppEvents(limit = 100): Promise<AppEventEntry[]> {
  const entries = await readJsonArrayFile<AppEventEntry>(APP_EVENTS_FILE);
  return entries.slice(0, Math.min(Math.max(limit, 1), 500));
}

/** RGPD Art. 17 — retire userId des événements applicatifs. */
export async function anonymizeAppEventsForUser(
  userId: string,
): Promise<{ updated: number }> {
  const entries = await readJsonArrayFile<AppEventEntry>(APP_EVENTS_FILE);
  let updated = 0;
  for (const entry of entries) {
    if (entry.userId === userId) {
      entry.userId = null;
      updated += 1;
    }
  }
  if (updated > 0) {
    await writeJsonArrayFile(APP_EVENTS_FILE, entries);
  }
  return { updated };
}
