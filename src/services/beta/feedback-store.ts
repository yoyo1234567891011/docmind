import { randomUUID } from "crypto";

import { FEEDBACK_FILE } from "@/config/paths";
import { getAppVersion, getDeployEnv } from "@/config/runtime";
import { sanitizeUserText } from "@/lib/sanitize";
import {
  appendJsonArrayEntry,
  readJsonArrayFile,
  writeJsonArrayFile,
} from "@/services/beta/json-store";
import type {
  FeedbackCategory,
  FeedbackEntry,
  FeedbackRating,
} from "@/types/beta";
import { FEEDBACK_CATEGORIES } from "@/types/beta";
import { appendAppEvent } from "@/services/beta/app-events";

export interface CreateFeedbackInput {
  userId?: string | null;
  email?: string | null;
  category: FeedbackCategory;
  rating?: FeedbackRating | null;
  message: string;
  page?: string | null;
  userAgent?: string | null;
}

export function isFeedbackCategory(value: string): value is FeedbackCategory {
  return (FEEDBACK_CATEGORIES as string[]).includes(value);
}

export async function createFeedback(
  input: CreateFeedbackInput,
): Promise<FeedbackEntry> {
  const message = sanitizeUserText(input.message, 2_000);
  if (message.length < 5) {
    throw new Error("Message trop court");
  }

  const entry: FeedbackEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    userId: input.userId ?? null,
    email: input.email ? sanitizeUserText(input.email, 120) : null,
    category: input.category,
    rating: input.rating ?? null,
    message,
    page: input.page ? sanitizeUserText(input.page, 300) : null,
    userAgent: input.userAgent
      ? sanitizeUserText(input.userAgent, 240)
      : null,
    appVersion: getAppVersion(),
    deployEnv: getDeployEnv(),
  };

  await appendJsonArrayEntry(FEEDBACK_FILE, entry);
  await appendAppEvent({
    level: "info",
    source: "feedback",
    message: `Nouveau feedback (${entry.category})`,
    userId: entry.userId,
    meta: { feedbackId: entry.id, rating: entry.rating ?? null },
  });

  return entry;
}

export async function listFeedback(limit = 100): Promise<FeedbackEntry[]> {
  const entries = await readJsonArrayFile<FeedbackEntry>(FEEDBACK_FILE);
  return entries.slice(0, Math.min(Math.max(limit, 1), 500));
}

/** RGPD Art. 17 — retire userId/email des feedbacks. */
export async function anonymizeFeedbackForUser(
  userId: string,
): Promise<{ updated: number }> {
  const entries = await readJsonArrayFile<FeedbackEntry>(FEEDBACK_FILE);
  let updated = 0;
  for (const entry of entries) {
    if (entry.userId === userId) {
      entry.userId = null;
      entry.email = null;
      updated += 1;
    }
  }
  if (updated > 0) {
    await writeJsonArrayFile(FEEDBACK_FILE, entries);
  }
  return { updated };
}
