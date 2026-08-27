import { cosineSimilarity } from "@/ai/models/embeddings";
import { getSearchIndexEntry } from "@/services/sheets/index-store";
import { getMemoryDocument } from "@/services/memory/document-store";
import {
  getCorpusSize,
  getDocsByCategory,
  getDocsByContentHash,
  getDocsByEntity,
  getDocsByFamily,
  getDocsBySimhashBands,
} from "@/services/memory/indexes";
import { isNegativeEdge } from "@/services/memory/negative-edges";
import { hammingDistanceHex } from "@/services/memory/simhash";
import type { MemoryDocumentNode } from "@/types/memory";

export const MAX_CANDIDATES = 20;
export const CANDIDATE_SELECTOR_BUDGET_MS = 50;

/** Paires cross-catégorie autorisées (architecture §4.1). */
const CROSS_CATEGORY: Array<[string, string]> = [
  ["facture", "contrat"],
  ["facture", "assurance"],
  ["bail", "assurance"],
  ["conditions-generales", "contrat"],
  ["conditions-generales", "assurance"],
];

export function areCategoriesRelationCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  if (neverCompare(a, b)) return false;
  return CROSS_CATEGORY.some(
    ([x, y]) => (x === a && y === b) || (x === b && y === a),
  );
}

export interface RelationCandidate {
  docId: string;
  score: number;
  reasons: string[];
  document: MemoryDocumentNode;
}

export interface CandidateSelectorResult {
  candidates: RelationCandidate[];
  durationMs: number;
  corpusSize: number;
  kMax: number;
  deferred: boolean;
}

function crossAllowed(a: string, b: string): boolean {
  return areCategoriesRelationCompatible(a, b);
}

function neverCompare(a: string, b: string): boolean {
  const pair = new Set([a, b]);
  if (pair.has("impots") && pair.has("bail")) return true;
  if (pair.has("facture") && pair.has("contrat-de-travail")) return true;
  if (pair.has("banque") && pair.has("assurance")) return true;
  if (pair.has("banque") && pair.has("contrat")) return true;
  if (pair.has("banque") && pair.has("bail")) return true;
  if (pair.has("banque") && pair.has("impots")) return true;
  return false;
}

function maxK(corpusSize: number): number {
  return Math.min(MAX_CANDIDATES, Math.max(1, Math.ceil(2 * Math.sqrt(corpusSize))));
}

function recencyScore(analyzedAt: string): number {
  const ageMs = Date.now() - Date.parse(analyzedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0.5;
  const days = ageMs / (86400_000);
  if (days < 30) return 1;
  if (days < 180) return 0.7;
  if (days < 365) return 0.4;
  if (days > 365 * 5) return 0.05;
  return 0.2;
}

/**
 * CandidateSelector incrémental — O(K), jamais O(N²).
 * Sources : fingerprint, simhash LSH, entity, family, catégorie (+ embed existant).
 */
export async function selectRelationCandidates(input: {
  userId: string;
  document: MemoryDocumentNode;
  primaryEntityIds: string[];
}): Promise<CandidateSelectorResult> {
  const started = Date.now();
  const { userId, document } = input;
  const corpusSize = await getCorpusSize(userId);
  const kMax = maxK(corpusSize);
  const scores = new Map<string, { score: number; reasons: string[] }>();

  const add = (docId: string, boost: number, reason: string) => {
    if (!docId || docId === document.documentId) return;
    const cur = scores.get(docId) ?? { score: 0, reasons: [] };
    cur.score += boost;
    if (!cur.reasons.includes(reason)) cur.reasons.push(reason);
    scores.set(docId, cur);
  };

  // 1. Hash exact
  if (document.contentHash) {
    for (const id of await getDocsByContentHash(userId, document.contentHash)) {
      add(id, 1.0, "content_hash");
    }
  }

  // 1b. SimHash LSH → filtrer Hamming ≤ 3
  if (document.simhash) {
    const bandHits = await getDocsBySimhashBands(userId, document.simhash);
    for (const id of bandHits) {
      if (id === document.documentId) continue;
      const other = await getMemoryDocument(userId, id);
      if (!other?.simhash) continue;
      const dist = hammingDistanceHex(document.simhash, other.simhash);
      if (dist <= 3) add(id, 0.95, `simhash_hamming_${dist}`);
      else if (dist <= 6) add(id, 0.35, `simhash_hamming_${dist}`);
    }
  }

  // 1c. Même contract family
  if (document.contractFamilyId) {
    for (const id of await getDocsByFamily(userId, document.contractFamilyId)) {
      add(id, 0.7, "same_family");
    }
  }

  // 1d. Top 5 by_entity (orgs en premier)
  const entityDocScores = new Map<string, number>();
  for (const entityId of input.primaryEntityIds.slice(0, 8)) {
    const docs = await getDocsByEntity(userId, entityId);
    for (const id of docs) {
      if (id === document.documentId) continue;
      entityDocScores.set(id, (entityDocScores.get(id) ?? 0) + 1);
    }
  }
  [...entityDocScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([id, overlap]) => {
      add(id, 0.3 * Math.min(1, overlap / 2), "entity_overlap");
    });

  // 2. Intra-catégorie (échantillon borné — jamais toute la cat si énorme)
  const sameCat = await getDocsByCategory(userId, document.category);
  const catSample = sameCat
    .filter((id) => id !== document.documentId)
    .slice(-80); // fenêtre récente approximative (append order)

  let selfEmbed: number[] | null = null;
  try {
    const selfIdx = await getSearchIndexEntry(userId, document.historyId);
    selfEmbed = selfIdx?.embedding ?? null;
  } catch {
    selfEmbed = null;
  }

  for (const id of catSample) {
    if (Date.now() - started > CANDIDATE_SELECTOR_BUDGET_MS) break;
    const other = await getMemoryDocument(userId, id);
    if (!other) continue;
    if (neverCompare(document.category, other.category)) continue;

    let embed = 0;
    if (selfEmbed) {
      try {
        const idx = await getSearchIndexEntry(userId, other.historyId);
        if (idx?.embedding?.length) {
          embed = cosineSimilarity(selfEmbed, idx.embedding);
        }
      } catch {
        embed = 0;
      }
    }
    const entityOverlap = input.primaryEntityIds.some((e) =>
      (other.primaryEntityIds ?? []).includes(e),
    )
      ? 1
      : 0;
    const ruleBoost = entityOverlap ? 0.8 : 0.4;
    const priority =
      0.4 * embed +
      0.3 * entityOverlap +
      0.2 * ruleBoost +
      0.1 * recencyScore(other.analyzedAt);
    add(id, priority, embed > 0.5 ? "category_embed" : "category");
  }

  // 3. Cross-catégorie whitelist (borné)
  for (const [a, b] of CROSS_CATEGORY) {
    if (Date.now() - started > CANDIDATE_SELECTOR_BUDGET_MS) break;
    if (document.category !== a && document.category !== b) continue;
    const otherCat = document.category === a ? b : a;
    const crossDocs = (await getDocsByCategory(userId, otherCat)).slice(-30);
    for (const id of crossDocs) {
      const other = await getMemoryDocument(userId, id);
      if (!other) continue;
      if (!crossAllowed(document.category, other.category)) continue;
      const shared = input.primaryEntityIds.some((e) =>
        (other.primaryEntityIds ?? []).includes(e),
      );
      if (!shared && document.category === "facture") continue;
      add(id, shared ? 0.55 : 0.25, "cross_category");
    }
  }

  const deferred = Date.now() - started > CANDIDATE_SELECTOR_BUDGET_MS;

  // Charger docs + couper à K
  const ranked = [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, kMax);

  const candidates: RelationCandidate[] = [];
  for (const [docId, meta] of ranked) {
    if (await isNegativeEdge(userId, document.documentId, docId)) continue;
    const doc = await getMemoryDocument(userId, docId);
    if (!doc) continue;
    if (doc.status === "archived") continue;
    if (neverCompare(document.category, doc.category)) continue;
    candidates.push({
      docId,
      score: meta.score,
      reasons: meta.reasons,
      document: doc,
    });
  }

  return {
    candidates,
    durationMs: Date.now() - started,
    corpusSize,
    kMax,
    deferred,
  };
}
