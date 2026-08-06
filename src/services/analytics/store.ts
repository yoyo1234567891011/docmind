import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { PRODUCT_ANALYTICS_FILE, SYSTEM_DIR } from "@/config/paths";
import { sanitizeUserText } from "@/lib/sanitize";
import type {
  AnalyticsEvent,
  AnalyticsEventName,
  AnalyticsFile,
  AnalyticsMeta,
} from "@/types/analytics";
import { ANALYTICS_EVENT_NAMES } from "@/types/analytics";

const MAX_EVENTS = 10_000;
const NAME_SET = new Set<string>(ANALYTICS_EVENT_NAMES);

function sanitizeMeta(meta?: AnalyticsMeta): AnalyticsMeta | undefined {
  if (!meta) return undefined;
  const out: AnalyticsMeta = {};
  for (const [key, value] of Object.entries(meta)) {
    const k = sanitizeUserText(key, 40);
    if (typeof value === "string") {
      out[k] = sanitizeUserText(value, 240);
    } else if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      out[k] = value;
    }
  }
  return out;
}

async function ensureSystemDir(): Promise<void> {
  await mkdir(SYSTEM_DIR, { recursive: true });
  await mkdir(path.dirname(PRODUCT_ANALYTICS_FILE), { recursive: true });
}

export async function readAnalyticsFile(): Promise<AnalyticsFile> {
  await ensureSystemDir();
  try {
    const raw = await readFile(PRODUCT_ANALYTICS_FILE, "utf8");
    const parsed = JSON.parse(raw) as AnalyticsFile;
    return {
      version: 1,
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch {
    const empty: AnalyticsFile = { version: 1, events: [] };
    await writeFile(
      PRODUCT_ANALYTICS_FILE,
      JSON.stringify(empty, null, 2),
      "utf8",
    );
    return empty;
  }
}

export function isAnalyticsEventName(value: string): value is AnalyticsEventName {
  return NAME_SET.has(value);
}

function hasIdempotencyKey(
  events: AnalyticsEvent[],
  key: string,
): boolean {
  return events.some((e) => e.meta?.idempotencyKey === key);
}

/**
 * Enregistre un événement produit. Ne doit jamais faire échouer le pipeline.
 * Si `idempotencyKey` est fourni et déjà vu → no-op (webhooks Stripe, sync).
 */
/**
 * Anonymise les événements d’un utilisateur (RGPD Art. 17 — post-delete).
 * Conserve les agrégats sans identifiant stable.
 */
export async function anonymizeAnalyticsForUser(
  userId: string,
): Promise<{ updated: number }> {
  const file = await readAnalyticsFile();
  let updated = 0;
  for (const event of file.events) {
    if (event.userId === userId) {
      event.userId = null;
      updated += 1;
    }
  }
  if (updated > 0) {
    await writeFile(
      PRODUCT_ANALYTICS_FILE,
      JSON.stringify(file, null, 2),
      "utf8",
    );
  }
  return { updated };
}

export async function trackAnalyticsEvent(input: {
  name: AnalyticsEventName;
  userId?: string | null;
  meta?: AnalyticsMeta;
  /** Clé unique anti-doublon (ex. evt Stripe, invoice id). */
  idempotencyKey?: string | null;
}): Promise<{ recorded: boolean }> {
  try {
    const file = await readAnalyticsFile();
    const key = input.idempotencyKey?.trim() || null;
    if (key && hasIdempotencyKey(file.events, key)) {
      return { recorded: false };
    }

    const meta = sanitizeMeta({
      ...input.meta,
      ...(key ? { idempotencyKey: key } : {}),
    });

    const entry: AnalyticsEvent = {
      id: randomUUID(),
      at: new Date().toISOString(),
      name: input.name,
      userId: input.userId ?? null,
      meta,
    };
    file.events.unshift(entry);
    if (file.events.length > MAX_EVENTS) {
      file.events = file.events.slice(0, MAX_EVENTS);
    }
    await writeFile(
      PRODUCT_ANALYTICS_FILE,
      JSON.stringify(file, null, 2),
      "utf8",
    );
    return { recorded: true };
  } catch {
    // Instrumentation never breaks the product path.
    return { recorded: false };
  }
}
