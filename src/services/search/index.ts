import { cosineSimilarity, embedText } from "@/ai/models/embeddings";
import { AppError } from "@/lib/errors";
import { listHistoryRecords } from "@/services/history";
import { matchRecordsToIntent } from "@/services/search/match";
import { parseSmartSearchIntent } from "@/services/search/parse-intent";
import {
  ensureDocumentSheet,
  indexDocumentSheet,
  listSearchIndexEntries,
} from "@/services/sheets";
import {
  UNFILED_FOLDER_ID,
  type HistoryRecord,
  type SmartSearchHit,
  type SmartSearchResult,
} from "@/types";

export interface RunSmartSearchOptions {
  userId: string;
  query: string;
  folderId?: string | "all";
  limit?: number;
}

const SEMANTIC_MIN = 0.32;

async function ensureRecordsIndexed(
  userId: string,
  records: HistoryRecord[],
): Promise<void> {
  const index = await listSearchIndexEntries(userId);
  const indexed = new Set(index.map((entry) => entry.historyId));

  for (const record of records) {
    if (indexed.has(record.id)) continue;
    const withSheet: HistoryRecord = {
      ...record,
      sheet: ensureDocumentSheet(record),
    };
    await indexDocumentSheet(userId, withSheet).catch(() => undefined);
  }
}

async function applySemanticBoost(
  userId: string,
  query: string,
  hits: SmartSearchHit[],
): Promise<SmartSearchHit[]> {
  if (hits.length === 0) return hits;

  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedText(query);
  } catch {
    return hits;
  }
  if (queryEmbedding.length === 0) return hits;

  const indexEntries = await listSearchIndexEntries(userId);
  const byId = new Map(
    indexEntries.map((entry) => [entry.historyId, entry]),
  );

  return hits
    .map((hit) => {
      const entry = byId.get(hit.item.id);
      if (!entry?.embedding?.length) return hit;

      const similarity = cosineSimilarity(queryEmbedding, entry.embedding);
      if (similarity < SEMANTIC_MIN) return hit;

      return {
        ...hit,
        score: hit.score + similarity * 8,
        reasons: [
          ...hit.reasons,
          {
            code: "semantic" as const,
            label: `Similarité IA ${(similarity * 100).toFixed(0)} %`,
          },
        ],
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Pipeline recherche langage naturel :
 * NL → intent (LLM + heuristique) → fiches structurées d’abord →
 * texte complet en secours → boost sémantique sur l’index.
 */
export async function runSmartSearch(
  options: RunSmartSearchOptions,
): Promise<SmartSearchResult> {
  const started = Date.now();
  const query = options.query?.trim();

  if (!query) {
    throw new AppError("BAD_REQUEST", "La requête de recherche est requise.");
  }
  if (query.length > 500) {
    throw new AppError(
      "BAD_REQUEST",
      "La requête est trop longue (500 caractères max).",
    );
  }

  const intent = await parseSmartSearchIntent(query);
  if (options.limit && options.limit > 0) {
    intent.limit = Math.min(options.limit, 50);
  }

  if (options.folderId && options.folderId !== "all") {
    intent.folderId =
      options.folderId === UNFILED_FOLDER_ID ? null : options.folderId;
  }

  const records = await listHistoryRecords(options.userId);
  await ensureRecordsIndexed(options.userId, records);

  let hits = matchRecordsToIntent(records, intent);
  hits = await applySemanticBoost(options.userId, query, hits);
  hits = hits.slice(0, intent.limit);

  const fromSheets = hits.filter((hit) => hit.matchedOn === "sheet").length;

  return {
    query,
    intent,
    hits,
    total: hits.length,
    tookMs: Date.now() - started,
    stats: {
      fromSheets,
      fromDocuments: hits.length - fromSheets,
    },
  };
}

export { parseSmartSearchIntent } from "./parse-intent";
export { parseIntentHeuristic } from "./heuristic";
export { matchRecordsToIntent } from "./match";
