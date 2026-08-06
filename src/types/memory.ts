/**
 * Modèle graphe — Mémoire documentaire personnelle (architecture P0→P6).
 * Contrat de données scoped par userId. Persistance FS court terme.
 */

export type MemoryEntityKind = "person" | "organization" | "product" | "place";

export type MemoryClauseType =
  | "preavis"
  | "franchise"
  | "tacite"
  | "exclusion"
  | "plafond"
  | "resiliation"
  | "autre";

export type MemoryDeadlineKind =
  | "paiement"
  | "resiliation"
  | "renouvellement"
  | "declaration"
  | "autre";

export type MemoryDeadlineStatus = "upcoming" | "past" | "snoozed";

export type MemoryRelationType =
  | "duplicate_of"
  | "supersedes"
  | "amends"
  | "same_contract_family"
  | "covers_same_risk"
  | "same_guarantee"
  | "linked_deadline"
  | "contradicts_clause"
  | "redundant_payment"
  | "party_shared"
  | "invoice_for"
  | "obsoletes_fact"
  | "cross_category";

export type MemoryRelationStatus =
  | "proposed"
  | "user_confirmed"
  | "user_dismissed"
  | "user_snoozed";

export type MemoryRelationMethod = "hash" | "rules" | "embed" | "llm";

export type MemoryRelationsPhase = "pending" | "ready" | "failed";

export type MemoryDocumentStatus =
  | "active"
  | "archived"
  | "possibly_replaced";

export type MemoryNodeRef =
  | { kind: "entity"; id: string }
  | { kind: "clause"; id: string }
  | { kind: "deadline"; id: string }
  | { kind: "document"; id: string };

export interface MemoryEntity {
  id: string;
  userId: string;
  kind: MemoryEntityKind;
  canonicalName: string;
  aliases: string[];
  /** Slug + éventuel SIREN/email. */
  normalizedKey: string;
  roleHints: string[];
  docIds: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  confidence: number;
}

export interface MemoryClause {
  id: string;
  userId: string;
  docId: string;
  historyId: string;
  clauseType: MemoryClauseType;
  textSpan: string;
  citationRef?: string | null;
  /** Durée jours, montant EUR, bool, ou texte normalisé. */
  normalizedValue?: string | number | boolean | null;
  embeddingRef?: string | null;
  hashNorm: string;
  createdAt: string;
}

export interface MemoryDeadline {
  id: string;
  userId: string;
  docId: string;
  historyId: string;
  dueDate: string | null;
  kind: MemoryDeadlineKind;
  amountEur?: number | null;
  label: string;
  entityId?: string | null;
  clusterId?: string | null;
  sourceSpan: string;
  status: MemoryDeadlineStatus;
  createdAt: string;
}

export interface MemoryRelationEvidence {
  field: string;
  left: string;
  right: string;
  note?: string;
}

export interface MemoryRelation {
  id: string;
  userId: string;
  type: MemoryRelationType;
  fromDocId: string;
  toDocId: string;
  fromNode?: MemoryNodeRef | null;
  toNode?: MemoryNodeRef | null;
  score: number;
  method: MemoryRelationMethod;
  evidence: MemoryRelationEvidence[];
  status: MemoryRelationStatus;
  createdAt: string;
  updatedAt: string;
  supersededBy?: string | null;
  /** Fin de snooze (ISO) si status = user_snoozed. */
  snoozedUntil?: string | null;
}

/** Métadonnées document côté graphe (sans dupliquer l’analyse). */
export interface MemoryDocumentNode {
  id: string;
  userId: string;
  documentId: string;
  historyId: string;
  fileName: string;
  displayName?: string | null;
  category: string;
  contentHash?: string | null;
  simhash?: string | null;
  textLength?: number;
  folderId?: string | null;
  tagIds?: string[];
  status: MemoryDocumentStatus;
  contractFamilyId?: string | null;
  analyzedAt: string;
  relationsPhase: MemoryRelationsPhase;
  primaryEntityIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MemoryRelationMetricsSummary {
  candidateSelectorMs: number;
  candidateCount: number;
  relationEngineMs: number;
  pairsCompared: number;
  relationsCreated: number;
  potentialFalsePositives: number;
}

export interface MemoryUpsertResult {
  document: MemoryDocumentNode;
  entities: MemoryEntity[];
  clauses: MemoryClause[];
  deadlines: MemoryDeadline[];
  relationsCreated: number;
  durationMs: number;
  /** Métriques P1 RelationEngine (absent si skip). */
  relationMetrics?: MemoryRelationMetricsSummary;
}

/** Événement timeline multi-documents (P4). */
export type MemoryTimelineEventKind =
  | "document"
  | "deadline"
  | "supersedes"
  | "amends"
  | "contradicts_clause"
  | "obsoletes_fact"
  | "invoice_for"
  | "other_relation";

export interface MemoryTimelineEvent {
  id: string;
  at: string;
  kind: MemoryTimelineEventKind;
  label: string;
  documentId: string;
  historyId: string | null;
  entityId: string | null;
  peerDocumentId?: string | null;
  score?: number;
}

export interface MemoryCounterpartyAggregate {
  entityId: string;
  name: string;
  documentCount: number;
  categories: string[];
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  relationCounts: Partial<Record<string, number>>;
  familyCount: number;
  timelinePreview: MemoryTimelineEvent[];
}
