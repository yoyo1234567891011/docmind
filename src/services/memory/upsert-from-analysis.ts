import { randomUUID } from "crypto";

import type { HistoryRecord } from "@/types/history";
import type {
  MemoryClause,
  MemoryDeadline,
  MemoryDocumentNode,
  MemoryEntity,
  MemoryUpsertResult,
} from "@/types/memory";
import { saveClausesForDoc } from "@/services/memory/clause-store";
import { saveDeadlinesForDoc } from "@/services/memory/deadline-store";
import {
  getMemoryDocument,
  saveMemoryDocument,
} from "@/services/memory/document-store";
import { upsertEntity } from "@/services/memory/entity-store";
import { computeTextFingerprints } from "@/services/memory/fingerprints";
import {
  bumpCorpusSize,
  indexCategoryDoc,
  indexDeadlineTime,
  indexEdgesByDoc,
  indexEntityDoc,
  indexFingerprint,
} from "@/services/memory/indexes";
import {
  deadlineStatusFromDue,
  hashNormText,
  inferClauseType,
  inferDeadlineKind,
  inferNormalizedClauseValue,
  inferRoleHints,
  parseAmountEur,
  parseDateToIso,
} from "@/services/memory/normalize";
import { buildRelationSignals } from "@/services/memory/detect-p3";
import { runRelationEngine } from "@/services/memory/relation-engine";
import { saveRelationSignals } from "@/services/memory/relation-signals";
import { listRelationsForDoc } from "@/services/memory/relation-store";

function collectClauseSpans(record: HistoryRecord): string[] {
  const spans = new Set<string>();
  for (const p of record.analysis.important_points ?? []) {
    if (/(préavis|franchise|tacite|exclusion|plafond|résiliation|resiliation)/i.test(p)) {
      spans.add(p.trim().slice(0, 400));
    }
  }
  for (const r of record.analysis.risks ?? []) {
    if (/(clause|préavis|franchise|exclusion|plafond|tacite)/i.test(r)) {
      spans.add(r.trim().slice(0, 400));
    }
  }
  for (const d of record.analysis.deadlines ?? []) {
    if (/préavis|délai|resiliation|résiliation/i.test(d)) {
      spans.add(d.trim().slice(0, 400));
    }
  }
  const text = record.extractedText || "";
  const patterns = [
    /[^.!\n]{0,40}préavis[^.!\n]{0,80}/gi,
    /[^.!\n]{0,40}franchise[^.!\n]{0,80}/gi,
    /[^.!\n]{0,40}tacite[^.!\n]{0,80}/gi,
    /[^.!\n]{0,40}exclusion[^.!\n]{0,100}/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const s = m[0].replace(/\s+/g, " ").trim();
      if (s.length >= 12 && s.length <= 220) spans.add(s);
      if (spans.size >= 12) break;
    }
    if (spans.size >= 12) break;
  }
  return [...spans].slice(0, 12);
}

/**
 * Étape C + P1 : upsert nœuds puis RelationEngine incrémental (K candidats).
 */
export async function upsertMemoryFromHistoryRecord(
  record: HistoryRecord,
  options?: { skipRelations?: boolean },
): Promise<MemoryUpsertResult> {
  const started = Date.now();
  const userId = record.userId;
  const docId = record.documentId;
  const seenAt = record.analyzedAt || record.createdAt || new Date().toISOString();

  const fingerprints = computeTextFingerprints(record.extractedText || "");
  const contentHash = record.contentHash || fingerprints.contentHash;
  const simhash = record.simhash || fingerprints.simhash;

  const previous = await getMemoryDocument(userId, docId);
  const document: MemoryDocumentNode = {
    id: previous?.id ?? randomUUID(),
    userId,
    documentId: docId,
    historyId: record.id,
    fileName: record.fileName,
    displayName: record.displayName ?? null,
    category: record.classification.category,
    contentHash,
    simhash,
    textLength: (record.extractedText || "").length,
    folderId: record.folderId,
    tagIds: record.tagIds ?? [],
    status: previous?.status ?? "active",
    contractFamilyId: previous?.contractFamilyId ?? null,
    analyzedAt: seenAt,
    relationsPhase: "pending",
    primaryEntityIds: [],
    createdAt: previous?.createdAt ?? record.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await saveMemoryDocument(userId, document);

  const entities: MemoryEntity[] = [];
  for (const name of record.analysis.people ?? []) {
    if (!name?.trim()) continue;
    const entity = await upsertEntity(userId, {
      kind: "person",
      name: name.trim(),
      docId,
      roleHints: inferRoleHints(name, "person"),
      confidence: 0.75,
      seenAt,
    });
    entities.push(entity);
    await indexEntityDoc(userId, entity.id, docId);
  }
  for (const name of record.analysis.organizations ?? []) {
    if (!name?.trim()) continue;
    const entity = await upsertEntity(userId, {
      kind: "organization",
      name: name.trim(),
      docId,
      roleHints: inferRoleHints(name, "organization"),
      confidence: 0.8,
      seenAt,
    });
    entities.push(entity);
    await indexEntityDoc(userId, entity.id, docId);
  }

  const uniqueEntities = [...new Map(entities.map((e) => [e.id, e])).values()];
  document.primaryEntityIds = uniqueEntities.map((e) => e.id);

  const clauses: MemoryClause[] = collectClauseSpans(record).map((span) => {
    const clauseType = inferClauseType(span);
    return {
      id: randomUUID(),
      userId,
      docId,
      historyId: record.id,
      clauseType,
      textSpan: span,
      citationRef: null,
      normalizedValue: inferNormalizedClauseValue(span, clauseType),
      embeddingRef: null,
      hashNorm: hashNormText(span),
      createdAt: new Date().toISOString(),
    };
  });
  const clauseByHash = new Map<string, MemoryClause>();
  for (const c of clauses) clauseByHash.set(c.hashNorm, c);
  const uniqueClauses = [...clauseByHash.values()];
  await saveClausesForDoc(userId, docId, uniqueClauses);

  const amountHint =
    (record.analysis.amounts ?? [])
      .map(parseAmountEur)
      .find((n) => n != null) ?? null;
  const primaryOrg =
    uniqueEntities.find((e) => e.kind === "organization") ?? null;

  const deadlines: MemoryDeadline[] = (record.analysis.deadlines ?? [])
    .filter((d) => d?.trim())
    .slice(0, 20)
    .map((label) => {
      const dueDate = parseDateToIso(label);
      return {
        id: randomUUID(),
        userId,
        docId,
        historyId: record.id,
        dueDate,
        kind: inferDeadlineKind(label),
        amountEur: amountHint,
        label: label.trim().slice(0, 200),
        entityId: primaryOrg?.id ?? null,
        clusterId: null,
        sourceSpan: label.trim().slice(0, 200),
        status: deadlineStatusFromDue(dueDate),
        createdAt: new Date().toISOString(),
      };
    });
  await saveDeadlinesForDoc(userId, docId, deadlines);
  for (const d of deadlines) {
    if (d.dueDate) await indexDeadlineTime(userId, d.dueDate, d.id);
  }

  // Signaux P3 (garanties / risques / paiements) — indépendants de l’historique
  await saveRelationSignals(
    userId,
    buildRelationSignals(record, document.category),
  );

  // Indexes incrémentaux (nouveau doc seulement)
  await indexFingerprint(userId, contentHash, docId, simhash);
  await indexCategoryDoc(userId, document.category, docId);
  await bumpCorpusSize(userId, docId);

  let relationsCreated = 0;
  let relationMetrics: MemoryUpsertResult["relationMetrics"];

  if (!options?.skipRelations) {
    const engine = await runRelationEngine({
      record: { ...record, contentHash, simhash },
      document,
      entities: uniqueEntities,
    });
    relationsCreated = engine.relations.length;
    relationMetrics = {
      candidateSelectorMs: engine.metrics.candidateSelectorMs,
      candidateCount: engine.metrics.candidateCount,
      relationEngineMs: engine.metrics.relationEngineMs,
      pairsCompared: engine.metrics.pairsCompared,
      relationsCreated: engine.metrics.relationsCreated,
      potentialFalsePositives: engine.metrics.potentialFalsePositives,
    };
  } else {
    const finalRels = await listRelationsForDoc(userId, docId);
    await indexEdgesByDoc(
      userId,
      docId,
      finalRels.map((r) => r.id),
    );
  }

  // Recharger document (family / status éventuellement mis à jour)
  const fresh = (await getMemoryDocument(userId, docId)) ?? document;
  fresh.relationsPhase = "ready";
  fresh.contentHash = contentHash;
  fresh.simhash = simhash;
  fresh.primaryEntityIds = uniqueEntities.map((e) => e.id);
  fresh.updatedAt = new Date().toISOString();
  await saveMemoryDocument(userId, fresh);

  return {
    document: fresh,
    entities: uniqueEntities,
    clauses: uniqueClauses,
    deadlines,
    relationsCreated,
    durationMs: Date.now() - started,
    relationMetrics,
  };
}
