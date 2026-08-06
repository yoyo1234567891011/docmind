/**
 * Timeline chronologique multi-documents (contrats / échéances / relations).
 */
import { listDeadlinesForDoc } from "@/services/memory/deadline-store";
import { getMemoryDocument } from "@/services/memory/document-store";
import { listEntities } from "@/services/memory/entity-store";
import { getDocsByEntity } from "@/services/memory/indexes";
import { listRelationsForDoc } from "@/services/memory/relation-store";
import { listContractFamilies } from "@/services/memory/contract-family";
import type {
  MemoryCounterpartyAggregate,
  MemoryTimelineEvent,
  MemoryTimelineEventKind,
} from "@/types/memory";

export type TimelineEvent = MemoryTimelineEvent;
export type TimelineEventKind = MemoryTimelineEventKind;
export type CounterpartyAggregate = MemoryCounterpartyAggregate;

function relationKind(type: string): TimelineEventKind {
  if (
    type === "supersedes" ||
    type === "amends" ||
    type === "contradicts_clause" ||
    type === "obsoletes_fact" ||
    type === "invoice_for"
  ) {
    return type;
  }
  return "other_relation";
}

/**
 * Timeline pour une contrepartie (entityId).
 */
export async function buildEntityTimeline(
  userId: string,
  entityId: string,
  options?: { limit?: number },
): Promise<TimelineEvent[]> {
  const limit = options?.limit ?? 80;
  const docIds = await getDocsByEntity(userId, entityId);
  const events: TimelineEvent[] = [];
  const seenRel = new Set<string>();

  for (const docId of docIds.slice(0, 60)) {
    const doc = await getMemoryDocument(userId, docId);
    if (!doc) continue;

    events.push({
      id: `doc:${docId}`,
      at: doc.analyzedAt,
      kind: "document",
      label: doc.displayName || doc.fileName,
      documentId: docId,
      historyId: doc.historyId,
      entityId,
    });

    const deadlines = await listDeadlinesForDoc(userId, docId);
    for (const d of deadlines) {
      if (!d.dueDate) continue;
      events.push({
        id: `deadline:${d.id}`,
        at: `${d.dueDate}T12:00:00.000Z`,
        kind: "deadline",
        label: d.label,
        documentId: docId,
        historyId: d.historyId,
        entityId: d.entityId || entityId,
      });
    }

    const rels = await listRelationsForDoc(userId, docId);
    for (const r of rels) {
      if (r.status === "user_dismissed") continue;
      const pairKey = [r.type, ...[r.fromDocId, r.toDocId].sort()].join("|");
      if (seenRel.has(pairKey)) continue;
      seenRel.add(pairKey);
      const kind = relationKind(r.type);
      if (kind === "other_relation" && r.score < 0.7) continue;
      events.push({
        id: `rel:${r.id}`,
        at: r.createdAt || doc.analyzedAt,
        kind,
        label: `${r.type} (${Math.round(r.score * 100)}%)`,
        documentId: r.fromDocId,
        historyId: doc.historyId,
        entityId,
        peerDocumentId: r.toDocId,
        score: r.score,
      });
    }
  }

  return events
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-limit);
}

/**
 * Timeline centrée sur un document (via ses entités primaires).
 */
export async function buildDocumentTimeline(
  userId: string,
  documentId: string,
  options?: { limit?: number },
): Promise<{
  documentId: string;
  entityIds: string[];
  events: TimelineEvent[];
}> {
  const doc = await getMemoryDocument(userId, documentId);
  if (!doc) {
    return { documentId, entityIds: [], events: [] };
  }
  const entityIds = doc.primaryEntityIds ?? [];
  const merged = new Map<string, TimelineEvent>();
  for (const entityId of entityIds.slice(0, 3)) {
    const events = await buildEntityTimeline(userId, entityId, {
      limit: options?.limit ?? 60,
    });
    for (const e of events) merged.set(e.id, e);
  }
  merged.set(`doc:${documentId}`, {
    id: `doc:${documentId}`,
    at: doc.analyzedAt,
    kind: "document",
    label: doc.displayName || doc.fileName,
    documentId,
    historyId: doc.historyId,
    entityId: entityIds[0] ?? null,
  });

  const events = [...merged.values()].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );
  return {
    documentId,
    entityIds,
    events: events.slice(-(options?.limit ?? 60)),
  };
}

/**
 * Agrégats par contrepartie (organisation).
 */
export async function listCounterpartyAggregates(
  userId: string,
  options?: { limit?: number },
): Promise<CounterpartyAggregate[]> {
  const limit = options?.limit ?? 40;
  const entities = (await listEntities(userId)).filter(
    (e) => e.kind === "organization",
  );
  const families = await listContractFamilies(userId);
  const out: CounterpartyAggregate[] = [];

  for (const entity of entities.slice(0, 80)) {
    const docIds = await getDocsByEntity(userId, entity.id);
    if (docIds.length === 0) continue;

    const categories = new Set<string>();
    let first: string | null = null;
    let last: string | null = null;
    const relationCounts: Partial<Record<string, number>> = {};
    const seenRel = new Set<string>();

    for (const docId of docIds) {
      const doc = await getMemoryDocument(userId, docId);
      if (!doc) continue;
      categories.add(doc.category);
      if (!first || doc.analyzedAt < first) first = doc.analyzedAt;
      if (!last || doc.analyzedAt > last) last = doc.analyzedAt;
      for (const r of await listRelationsForDoc(userId, docId)) {
        const key = [r.type, ...[r.fromDocId, r.toDocId].sort()].join("|");
        if (seenRel.has(key)) continue;
        seenRel.add(key);
        relationCounts[r.type] = (relationCounts[r.type] ?? 0) + 1;
      }
    }

    const familyCount = families.filter(
      (f) => f.primaryEntityId === entity.id,
    ).length;
    const timelinePreview = (
      await buildEntityTimeline(userId, entity.id, { limit: 5 })
    ).slice(-5);

    out.push({
      entityId: entity.id,
      name: entity.canonicalName,
      documentCount: docIds.length,
      categories: [...categories],
      firstSeenAt: first,
      lastSeenAt: last,
      relationCounts,
      familyCount,
      timelinePreview,
    });
  }

  return out
    .sort((a, b) => b.documentCount - a.documentCount)
    .slice(0, limit);
}
