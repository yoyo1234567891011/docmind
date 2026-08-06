import { generateForTask } from "@/ai/models";
import { buildSmartSearchIntentPrompt } from "@/ai/prompts";
import { parseJsonObject } from "@/ai/validation";
import { parseIntentHeuristic } from "@/services/search/heuristic";
import {
  DOCUMENT_CATEGORIES,
  EMPTY_SMART_SEARCH_INTENT,
  type DocumentCategory,
  type SmartSearchAmountFilter,
  type SmartSearchDateFilter,
  type SmartSearchIntent,
} from "@/types";

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function parseAmount(value: unknown): SmartSearchAmountFilter | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const operator = String(obj.operator ?? "");
  const amountValue = Number(obj.value);
  if (
    !["gt", "gte", "lt", "lte", "eq", "between"].includes(operator) ||
    !Number.isFinite(amountValue)
  ) {
    return null;
  }
  const valueMax = Number(obj.valueMax);
  return {
    operator: operator as SmartSearchAmountFilter["operator"],
    value: amountValue,
    valueMax: Number.isFinite(valueMax) ? valueMax : undefined,
  };
}

function parseDate(value: unknown): SmartSearchDateFilter | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const field = String(obj.field ?? "any");
  if (!["any", "deadline", "document", "analyzed"].includes(field)) {
    return null;
  }
  const year = Number(obj.year);
  return {
    field: field as SmartSearchDateFilter["field"],
    from: obj.from ? String(obj.from) : undefined,
    to: obj.to ? String(obj.to) : undefined,
    year: Number.isFinite(year) ? year : undefined,
  };
}

function normalizeLlmIntent(
  query: string,
  parsed: Record<string, unknown>,
): SmartSearchIntent {
  const categories = asStringArray(parsed.categories).filter((category) =>
    (DOCUMENT_CATEGORIES as readonly string[]).includes(category),
  ) as DocumentCategory[];

  const limit = Number(parsed.limit);
  return {
    ...EMPTY_SMART_SEARCH_INTENT,
    rawQuery: query,
    interpretedAs:
      String(parsed.interpretedAs ?? "").trim() ||
      "Recherche intelligente sur vos documents",
    keywords: asStringArray(parsed.keywords),
    organizations: asStringArray(parsed.organizations),
    people: asStringArray(parsed.people),
    documentTypes: asStringArray(parsed.documentTypes),
    categories,
    amount: parseAmount(parsed.amount),
    date: parseDate(parsed.date),
    riskLevels: asStringArray(parsed.riskLevels) as SmartSearchIntent["riskLevels"],
    needsAction:
      typeof parsed.needsAction === "boolean" ? parsed.needsAction : null,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50) : 20,
    source: "llm",
  };
}

function mergeIntents(
  primary: SmartSearchIntent,
  fallback: SmartSearchIntent,
): SmartSearchIntent {
  return {
    ...primary,
    source: "hybrid",
    keywords: [...new Set([...primary.keywords, ...fallback.keywords])],
    organizations: [
      ...new Set([...primary.organizations, ...fallback.organizations]),
    ],
    people: [...new Set([...primary.people, ...fallback.people])],
    documentTypes: [
      ...new Set([...primary.documentTypes, ...fallback.documentTypes]),
    ],
    categories: [
      ...new Set([...primary.categories, ...fallback.categories]),
    ],
    amount: primary.amount ?? fallback.amount,
    date: primary.date ?? fallback.date,
    interpretedAs: primary.interpretedAs || fallback.interpretedAs,
  };
}

/**
 * Parse NL query into structured intent.
 * Tries local LLM first, always keeps a heuristic baseline.
 */
export async function parseSmartSearchIntent(
  query: string,
): Promise<SmartSearchIntent> {
  const trimmed = query.trim();
  const heuristic = parseIntentHeuristic(trimmed);

  if (!trimmed) {
    return heuristic;
  }

  try {
    const generation = await generateForTask(
      "searchIntent",
      buildSmartSearchIntentPrompt(trimmed),
    );
    const parsed = parseJsonObject<Record<string, unknown>>(generation.text);
    const llmIntent = normalizeLlmIntent(trimmed, parsed);
    return mergeIntents(llmIntent, heuristic);
  } catch {
    return heuristic;
  }
}
