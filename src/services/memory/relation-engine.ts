import { randomUUID } from "crypto";

import { cosineSimilarity } from "@/ai/models/embeddings";
import { getSearchIndexEntry } from "@/services/sheets/index-store";
import {
  selectRelationCandidates,
  MAX_CANDIDATES,
  areCategoriesRelationCompatible,
} from "@/services/memory/candidate-selector";
import { upsertContractFamily } from "@/services/memory/contract-family";
import { getMemoryDocument, saveMemoryDocument } from "@/services/memory/document-store";
import { indexEdgesByDoc } from "@/services/memory/indexes";
import {
  appendRelationMetrics,
  type RelationRunMetrics,
} from "@/services/memory/metrics";
import { normalizeEntityKey, parseDateToIso } from "@/services/memory/normalize";
import {
  listAllRelations,
  listRelationsForDoc,
  saveRelationsForDoc,
  upsertRelation,
} from "@/services/memory/relation-store";
import { detectP3Relations } from "@/services/memory/detect-p3";
import { detectP4Relations } from "@/services/memory/detect-p4";
import { assignDeadlineClustersForDoc } from "@/services/memory/deadline-clusters";
import { scheduleAmbiguousRelationVerify } from "@/services/memory/ambiguous-llm";
import { isNegativeEdge } from "@/services/memory/negative-edges";
import { hammingDistanceHex } from "@/services/memory/simhash";
import type { HistoryRecord } from "@/types/history";
import type {
  MemoryDocumentNode,
  MemoryEntity,
  MemoryRelation,
  MemoryRelationEvidence,
} from "@/types/memory";

export const RELATION_ENGINE_PAIR_BUDGET_MS = 100;

export interface RelationEngineResult {
  relations: MemoryRelation[];
  metrics: RelationRunMetrics;
}

function titleTokens(title: string): Set<string> {
  return new Set(
    normalizeEntityKey(title)
      .split(/[\s-]+/)
      .filter((t) => t.length >= 3),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function docTitle(record: HistoryRecord | null, node: MemoryDocumentNode): string {
  return (
    record?.displayName ||
    record?.analysis?.title ||
    node.displayName ||
    node.fileName ||
    ""
  );
}

function evidence(
  field: string,
  left: string,
  right: string,
  note?: string,
): MemoryRelationEvidence {
  return { field, left, right, note };
}

function makeRelation(input: {
  userId: string;
  type: MemoryRelation["type"];
  fromDocId: string;
  toDocId: string;
  score: number;
  method: MemoryRelation["method"];
  evidence: MemoryRelationEvidence[];
  fromNode?: MemoryRelation["fromNode"];
  toNode?: MemoryRelation["toNode"];
}): MemoryRelation {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    userId: input.userId,
    type: input.type,
    fromDocId: input.fromDocId,
    toDocId: input.toDocId,
    fromNode: input.fromNode ?? null,
    toNode: input.toNode ?? null,
    score: input.score,
    method: input.method,
    evidence: input.evidence,
    status: "proposed",
    createdAt: now,
    updatedAt: now,
  };
}

async function loadHistoryLite(
  userId: string,
  historyId: string,
): Promise<HistoryRecord | null> {
  try {
    const { getHistoryRecord } = await import("@/services/history/store");
    return await getHistoryRecord(userId, historyId);
  } catch {
    return null;
  }
}

/**
 * Détection cheap d’une paire — pas de LLM.
 * Budget cible < 100 ms / paire.
 */
export async function detectRelationsForPair(input: {
  userId: string;
  source: MemoryDocumentNode;
  sourceRecord: HistoryRecord;
  candidate: MemoryDocumentNode;
  sharedEntityIds: string[];
}): Promise<MemoryRelation[]> {
  const pairStarted = Date.now();
  const out: MemoryRelation[] = [];
  const { userId, source, candidate, sourceRecord, sharedEntityIds } = input;
  const candRecord = await loadHistoryLite(userId, candidate.historyId);

  const titleA = docTitle(sourceRecord, source);
  const titleB = docTitle(candRecord, candidate);
  const titleSim = jaccard(titleTokens(titleA), titleTokens(titleB));

  const sameCategory = source.category === candidate.category;
  const sharedEntity = sharedEntityIds[0] ?? null;
  const categoriesCompatible = areCategoriesRelationCompatible(
    source.category,
    candidate.category,
  );

  // --- duplicate_of ---
  if (
    source.contentHash &&
    candidate.contentHash &&
    source.contentHash === candidate.contentHash
  ) {
    out.push(
      makeRelation({
        userId,
        type: "duplicate_of",
        fromDocId: source.documentId,
        toDocId: candidate.documentId,
        score: 1,
        method: "hash",
        evidence: [
          evidence(
            "content_hash",
            source.contentHash.slice(0, 16),
            candidate.contentHash.slice(0, 16),
            "Hash SHA-256 identique",
          ),
        ],
      }),
    );
  } else if (source.simhash && candidate.simhash) {
    const dist = hammingDistanceHex(source.simhash, candidate.simhash);
    if (dist <= 2 && (sameCategory || dist === 0)) {
      out.push(
        makeRelation({
          userId,
          type: "duplicate_of",
          fromDocId: source.documentId,
          toDocId: candidate.documentId,
          score: dist === 0 ? 0.99 : 0.95 - dist * 0.01,
          method: "hash",
          evidence: [
            evidence(
              "simhash_hamming",
              String(dist),
              "≤3",
              `Distance Hamming SimHash = ${dist}`,
            ),
            evidence("title", titleA.slice(0, 80), titleB.slice(0, 80)),
          ],
        }),
      );
    }
  }

  // Embedding existant (search-index) — pas de nouvel appel LLM
  if (
    !out.some((r) => r.type === "duplicate_of") &&
    Date.now() - pairStarted < RELATION_ENGINE_PAIR_BUDGET_MS
  ) {
    try {
      const [a, b] = await Promise.all([
        getSearchIndexEntry(userId, source.historyId),
        getSearchIndexEntry(userId, candidate.historyId),
      ]);
      if (a?.embedding?.length && b?.embedding?.length) {
        const cos = cosineSimilarity(a.embedding, b.embedding);
        const lenA = source.textLength ?? 0;
        const lenB = candidate.textLength ?? 0;
        const lenRatio =
          lenA > 0 && lenB > 0
            ? Math.min(lenA, lenB) / Math.max(lenA, lenB)
            : 0;
        if (cos > 0.985 && lenRatio >= 0.92 && sameCategory) {
          out.push(
            makeRelation({
              userId,
              type: "duplicate_of",
              fromDocId: source.documentId,
              toDocId: candidate.documentId,
              score: Math.min(0.98, cos),
              method: "embed",
              evidence: [
                evidence(
                  "embedding_cosine",
                  cos.toFixed(4),
                  ">0.98",
                  "Cosine embeddings search-index",
                ),
                evidence(
                  "text_length_ratio",
                  String(lenA),
                  String(lenB),
                  `ratio=${lenRatio.toFixed(2)}`,
                ),
              ],
            }),
          );
        }
      }
    } catch {
      // embeddings absents — ignorer
    }
  }

  const isDuplicate = out.some((r) => r.type === "duplicate_of" && r.score >= 0.95);

  // --- supersedes / same_contract_family ---
  if (
    !isDuplicate &&
    sameCategory &&
    categoriesCompatible &&
    sharedEntity &&
    Date.now() - pairStarted < RELATION_ENGINE_PAIR_BUDGET_MS
  ) {
    const dateA =
      parseDateToIso(sourceRecord.analysis?.date || "") ||
      source.analyzedAt.slice(0, 10);
    const dateB =
      parseDateToIso(candRecord?.analysis?.date || "") ||
      candidate.analyzedAt.slice(0, 10);
    const tA = Date.parse(dateA);
    const tB = Date.parse(dateB);
    const newerIsSource = Number.isFinite(tA) && Number.isFinite(tB) && tA > tB;
    const olderIsSource = Number.isFinite(tA) && Number.isFinite(tB) && tA < tB;
    const dateGapDays =
      Number.isFinite(tA) && Number.isFinite(tB)
        ? Math.abs(tA - tB) / 86400_000
        : null;

    // Famille : même org + catégorie + titres un minimum liés OU gap temporel
    const familySignal =
      titleSim >= 0.38 ||
      (dateGapDays != null && dateGapDays >= 60 && dateGapDays <= 500);

    if (familySignal) {
      const familyEv: MemoryRelationEvidence[] = [
        evidence(
          "entity_id",
          sharedEntity,
          sharedEntity,
          "Même contrepartie organisation",
        ),
        evidence("category", source.category, candidate.category),
        evidence(
          "title_jaccard",
          titleSim.toFixed(2),
          titleA.slice(0, 60),
          titleB.slice(0, 60),
        ),
      ];

      out.push(
        makeRelation({
          userId,
          type: "same_contract_family",
          fromDocId: source.documentId,
          toDocId: candidate.documentId,
          score: Math.min(0.92, 0.55 + titleSim * 0.3 + (dateGapDays ? 0.1 : 0)),
          method: "rules",
          evidence: familyEv,
          fromNode: { kind: "entity", id: sharedEntity },
          toNode: { kind: "entity", id: sharedEntity },
        }),
      );

      // supersedes si plus récent + titres proches + écart plausible renouvellement
      const renewGap =
        dateGapDays != null && dateGapDays >= 60 && dateGapDays <= 500;
      const supersedeScore =
        (titleSim >= 0.35 ? 0.35 : 0) +
        (renewGap ? 0.35 : dateGapDays != null && dateGapDays > 0 ? 0.15 : 0) +
        0.25; // shared entity+cat

      if (
        supersedeScore >= 0.78 &&
        (newerIsSource || olderIsSource) &&
        titleSim >= 0.38
      ) {
        const fromDoc = newerIsSource
          ? source.documentId
          : candidate.documentId;
        const toDoc = newerIsSource
          ? candidate.documentId
          : source.documentId;
        out.push(
          makeRelation({
            userId,
            type: "supersedes",
            fromDocId: fromDoc,
            toDocId: toDoc,
            score: Math.min(0.93, supersedeScore),
            method: "rules",
            evidence: [
              ...familyEv,
              evidence(
                "document_date",
                newerIsSource ? dateA : dateB,
                newerIsSource ? dateB : dateA,
                "Document plus récent remplace l’antérieur",
              ),
              ...(dateGapDays != null
                ? [
                    evidence(
                      "date_gap_days",
                      String(Math.round(dateGapDays)),
                      "60–500",
                      "Écart compatible renouvellement",
                    ),
                  ]
                : []),
            ],
            fromNode: { kind: "entity", id: sharedEntity },
          }),
        );
      }
    }
  }

  // Soft party_shared si entity partagée et pas déjà couvert
  if (
    sharedEntity &&
    categoriesCompatible &&
    !out.some((r) => r.type === "same_contract_family" || r.type === "duplicate_of")
  ) {
    out.push(
      makeRelation({
        userId,
        type: "party_shared",
        fromDocId: source.documentId,
        toDocId: candidate.documentId,
        score: 0.55,
        method: "rules",
        evidence: [
          evidence(
            "entity_id",
            sharedEntity,
            sharedEntity,
            "Contrepartie partagée (candidat)",
          ),
        ],
        fromNode: { kind: "entity", id: sharedEntity },
        toNode: { kind: "entity", id: sharedEntity },
      }),
    );
  }

  // --- P3 : garanties, risques, paiements, échéances (toujours, hors gate embed) ---
  {
    const p3 = await detectP3Relations({
      userId,
      source,
      candidate,
      sourceRecord,
      candidateRecord: candRecord,
      sharedEntityIds,
    });
    out.push(...p3);
  }

  // --- P4 : contradictions, faits obsolètes, avenants, factures (toujours) ---
  {
    const p4 = await detectP4Relations({
      userId,
      source,
      candidate,
      sourceRecord,
      candidateRecord: candRecord,
      sharedEntityIds,
    });
    out.push(...p4);
  }

  // Garantir ≥1 evidence
  return out.filter((r) => r.evidence.length >= 1);
}

/**
 * Pipeline P1 : CandidateSelector → RelationEngine cheap (K paires max).
 * Met à jour uniquement les edges du nouveau document (+ miroir borné).
 */
export async function runRelationEngine(input: {
  record: HistoryRecord;
  document: MemoryDocumentNode;
  entities: MemoryEntity[];
}): Promise<RelationEngineResult> {
  const { record, document, entities } = input;
  const userId = record.userId;
  const primaryEntityIds = entities.map((e) => e.id);

  const selection = await selectRelationCandidates({
    userId,
    document,
    primaryEntityIds,
  });

  const engineStarted = Date.now();
  const created: MemoryRelation[] = [];
  const byType: RelationRunMetrics["byType"] = {};
  let potentialFalsePositives = 0;

  // Les dérivés auto du document ont déjà été purgés en réindex
  // (clearDerivedMemoryForReindex). On retire encore d’éventuels proposed
  // restants (1ʳᵉ indexation / skip clear) avant de recalculer.
  const docId = document.documentId;
  const previous = await listRelationsForDoc(userId, docId);
  const keepUserTouched = previous.filter(
    (r) =>
      r.status === "user_confirmed" ||
      r.status === "user_dismissed" ||
      r.status === "user_snoozed",
  );

  const peerIds = new Set<string>();
  for (const r of await listAllRelations(userId)) {
    if (r.fromDocId === docId) peerIds.add(r.toDocId);
    if (r.toDocId === docId) peerIds.add(r.fromDocId);
  }
  peerIds.delete(docId);

  await saveRelationsForDoc(userId, docId, keepUserTouched);

  for (const peerId of peerIds) {
    const existing = await listRelationsForDoc(userId, peerId);
    const filtered = existing.filter((r) => {
      const involves = r.fromDocId === docId || r.toDocId === docId;
      if (!involves) return true;
      return (
        r.status === "user_confirmed" ||
        r.status === "user_dismissed" ||
        r.status === "user_snoozed"
      );
    });
    if (filtered.length !== existing.length) {
      await saveRelationsForDoc(userId, peerId, filtered);
    }
  }

  const pairs = selection.candidates.slice(0, MAX_CANDIDATES);
  for (const cand of pairs) {
    if (await isNegativeEdge(userId, docId, cand.docId)) {
      continue;
    }
    const shared = primaryEntityIds.filter((id) =>
      (cand.document.primaryEntityIds ?? []).includes(id),
    );
    // Si pas d'entité partagée, encore autorisé pour hash/simhash reasons
    const hashDriven = cand.reasons.some(
      (r) => r === "content_hash" || r.startsWith("simhash_"),
    );
    if (shared.length === 0 && !hashDriven && cand.score < 0.5) continue;

    const detected = await detectRelationsForPair({
      userId,
      source: document,
      sourceRecord: record,
      candidate: cand.document,
      sharedEntityIds: shared,
    });

    for (const rel of detected) {
      if (!rel.evidence?.length) continue;
      await upsertRelation(userId, docId, rel);
      await upsertRelation(userId, rel.toDocId, {
        ...rel,
        id: randomUUID(),
        fromDocId: rel.toDocId,
        toDocId: rel.fromDocId,
      });
      created.push(rel);
      byType[rel.type as keyof typeof byType] =
        (byType[rel.type as keyof typeof byType] ?? 0) + 1;

      if (
        (rel.score >= 0.7 && rel.score < 0.85) ||
        (rel.type === "supersedes" &&
          !rel.evidence.some((e) => e.field === "document_date"))
      ) {
        potentialFalsePositives += 1;
      }

      // Contract family + soft status
      if (
        rel.type === "same_contract_family" ||
        rel.type === "supersedes"
      ) {
        const org =
          entities.find((e) => e.kind === "organization") ?? entities[0];
        const family = await upsertContractFamily({
          userId,
          category: document.category,
          primaryEntityId: org?.id ?? null,
          label: record.analysis.title || document.fileName,
          docIds: [rel.fromDocId, rel.toDocId],
          currentDocId:
            rel.type === "supersedes" ? rel.fromDocId : docId,
        });
        document.contractFamilyId = family.id;
        if (rel.type === "supersedes" && rel.toDocId !== docId) {
          const old = await getMemoryDocument(userId, rel.toDocId);
          if (old) {
            old.status = "possibly_replaced";
            old.contractFamilyId = family.id;
            old.updatedAt = new Date().toISOString();
            await saveMemoryDocument(userId, old);
          }
        }
      }
    }
  }

  for (const r of keepUserTouched) {
    await upsertRelation(userId, docId, r);
  }

  const finalRels = await listRelationsForDoc(userId, docId);
  await indexEdgesByDoc(
    userId,
    docId,
    finalRels.map((r) => r.id),
  );

  document.contractFamilyId = document.contractFamilyId ?? null;
  document.updatedAt = new Date().toISOString();
  await saveMemoryDocument(userId, document);

  // Clusters d'échéances (±7 j) — incrémental, hors budget paire
  try {
    await assignDeadlineClustersForDoc(userId, document.documentId);
  } catch {
    // non bloquant
  }

  const metrics: RelationRunMetrics = {
    at: new Date().toISOString(),
    userId,
    documentId: document.documentId,
    historyId: record.id,
    corpusSize: selection.corpusSize,
    candidateSelectorMs: selection.durationMs,
    candidateCount: selection.candidates.length,
    relationEngineMs: Date.now() - engineStarted,
    pairsCompared: pairs.length,
    relationsCreated: created.length,
    byType,
    potentialFalsePositives,
    deferred: selection.deferred,
  };
  await appendRelationMetrics(metrics);

  // LLM ambigu hors chemin critique (opt-in env MEMORY_RELATION_LLM_VERIFY=1)
  scheduleAmbiguousRelationVerify({
    userId,
    documentId: document.documentId,
    relations: created,
  });

  return { relations: created, metrics };
}
