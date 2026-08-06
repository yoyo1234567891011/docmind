import { AppError } from "@/lib/errors";
import { getMemoryDocument } from "@/services/memory/document-store";
import { getDocsByCategory } from "@/services/memory/indexes";
import {
  addNegativeEdge,
  isNegativeEdge,
  removeNegativeEdge,
} from "@/services/memory/negative-edges";
import {
  listRelationsForDoc,
  upsertRelation,
} from "@/services/memory/relation-store";
import { indexEdgesByDoc } from "@/services/memory/indexes";
import type {
  MemoryRelation,
  MemoryRelationEvidence,
  MemoryRelationType,
  MemoryRelationsPhase,
} from "@/types/memory";

export type RelationConfidenceLabel = "Élevé" | "Moyen" | "Faible";

export type RelationUiAction = "confirm" | "dismiss" | "snooze";

export interface RelationPeerView {
  documentId: string;
  historyId: string | null;
  title: string;
  fileName: string;
  analyzedAt: string | null;
  category: string | null;
}

export interface RelationListItem {
  id: string;
  type: MemoryRelationType;
  typeLabel: string;
  score: number;
  confidenceLabel: RelationConfidenceLabel;
  status: MemoryRelation["status"];
  message: string;
  evidence: MemoryRelationEvidence[];
  fromDocId: string;
  toDocId: string;
  peer: RelationPeerView;
  snoozedUntil?: string | null;
}

export interface RelationsUiPayload {
  documentId: string;
  relationsPhase: MemoryRelationsPhase;
  sameCategoryCount: number;
  relations: RelationListItem[];
}

const TYPE_LABELS: Record<MemoryRelationType, string> = {
  duplicate_of: "Doublon",
  supersedes: "Remplacement",
  amends: "Avenant",
  same_contract_family: "Même famille de contrat",
  covers_same_risk: "Risque couvert 2×",
  same_guarantee: "Garantie déjà présente",
  linked_deadline: "Échéances liées",
  contradicts_clause: "Clauses contradictoires",
  redundant_payment: "Paiement redondant",
  party_shared: "Même contrepartie",
  invoice_for: "Facture liée",
  obsoletes_fact: "Information obsolète",
  cross_category: "Lien cross-catégorie",
};

/** Poids de tri UX (sévérité / importance). */
const TYPE_WEIGHT: Record<MemoryRelationType, number> = {
  duplicate_of: 100,
  supersedes: 95,
  contradicts_clause: 90,
  covers_same_risk: 80,
  same_guarantee: 75,
  redundant_payment: 70,
  same_contract_family: 65,
  linked_deadline: 60,
  amends: 55,
  obsoletes_fact: 50,
  invoice_for: 45,
  party_shared: 40,
  cross_category: 30,
};

const SNOOZE_DAYS = 14;

export function confidenceLabelFromScore(score: number): RelationConfidenceLabel {
  if (score >= 0.9) return "Élevé";
  if (score >= 0.7) return "Moyen";
  return "Faible";
}

export function buildRelationMessage(
  type: MemoryRelationType,
  peer: RelationPeerView,
  evidence: MemoryRelationEvidence[],
): string {
  const title = peer.title || peer.fileName || "un autre document";
  const dateEv = evidence.find((e) => e.field === "document_date");
  const date = dateEv?.right || peer.analyzedAt?.slice(0, 10) || "";
  const entityEv = evidence.find((e) => e.field === "entity_id");

  switch (type) {
    case "supersedes":
      return date
        ? `Ce contrat remplace probablement celui du ${date} (${title}).`
        : `Ce contrat remplace probablement « ${title} ».`;
    case "duplicate_of":
      return `Ce document semble être un doublon de « ${title} ».`;
    case "same_contract_family":
      return `Même famille de contrat que « ${title} » (renouvellement ou version liée).`;
    case "party_shared":
      return entityEv?.note
        ? `Même contrepartie que « ${title} » (${entityEv.note}).`
        : `Même contrepartie que dans « ${title} ».`;
    case "same_guarantee": {
      const g = evidence.find((e) => e.field === "guarantee_labels")?.left;
      return g
        ? `Garantie « ${g} » déjà présente dans « ${title} ».`
        : `Cette garantie semble déjà présente dans « ${title} ».`;
    }
    case "covers_same_risk": {
      const risk = evidence.find((e) => e.field === "risk_labels")?.left;
      return risk
        ? `Deux contrats couvrent le même risque (${risk}) — voir « ${title} ».`
        : `Deux contrats couvrent probablement le même risque (voir « ${title} »).`;
    }
    case "linked_deadline": {
      const due = evidence.find((e) => e.field === "due_date");
      return due
        ? `Échéance du ${due.left} proche de celle de « ${title} » (${due.right}).`
        : `Échéance liée à celle de « ${title} ».`;
    }
    case "contradicts_clause": {
      const clause = evidence.find((e) => e.field === "clause_type")?.left;
      const why = evidence.find((e) => e.field === "justification")?.left;
      if (clause && why) {
        return `Contradiction sur « ${clause} » avec « ${title} » — ${why}.`;
      }
      return `Clause potentiellement contradictoire avec « ${title} ».`;
    }
    case "redundant_payment": {
      const amount = evidence.find((e) => e.field === "amount_eur")?.left;
      const period = evidence.find((e) => e.field === "periodicity")?.left;
      if (amount && period && period !== "inconnue") {
        return `Paiement ${amount} € (${period}) déjà engagé — voir « ${title} ».`;
      }
      return amount
        ? `Montant similaire (${amount} €) déjà engagé (voir « ${title} »).`
        : `Montant similaire déjà engagé (voir « ${title} »).`;
    }
    case "obsoletes_fact": {
      const kind = evidence.find((e) => e.field === "fact_kind")?.left || "fait";
      const value = evidence.find((e) => e.field === "fact_value");
      return value
        ? `Fait obsolète (${kind}) : « ${value.right} » remplacé par « ${value.left} » (voir « ${title} »).`
        : `Une information de « ${title} » est probablement dépassée (${kind}).`;
    }
    case "invoice_for":
      return `Facture probablement liée au contrat « ${title} ».`;
    case "amends":
      return `Avenant probable de « ${title} ».`;
    default:
      return `Lien détecté avec « ${title} ».`;
  }
}

function isVisible(rel: MemoryRelation, now = Date.now()): boolean {
  if (rel.status === "user_dismissed") return false;
  if (rel.status === "user_snoozed") {
    if (!rel.snoozedUntil) return false;
    const until = Date.parse(rel.snoozedUntil);
    return Number.isFinite(until) && until <= now;
  }
  return true;
}

async function peerView(
  userId: string,
  peerDocId: string,
): Promise<RelationPeerView> {
  const node = await getMemoryDocument(userId, peerDocId);
  return {
    documentId: peerDocId,
    historyId: node?.historyId ?? null,
    title: node?.displayName || node?.fileName || peerDocId.slice(0, 8),
    fileName: node?.fileName || `${peerDocId}.pdf`,
    analyzedAt: node?.analyzedAt ?? null,
    category: node?.category ?? null,
  };
}

/**
 * Liste UI des relations pour un document — triées par importance.
 */
export async function getRelationsForUi(
  userId: string,
  documentId: string,
): Promise<RelationsUiPayload> {
  const node = await getMemoryDocument(userId, documentId);
  const relationsPhase: MemoryRelationsPhase =
    node?.relationsPhase ?? (node ? "ready" : "pending");

  const raw = await listRelationsForDoc(userId, documentId);
  const visible = raw.filter((r) => isVisible(r));

  const items: RelationListItem[] = [];
  for (const rel of visible) {
    const peerDocId =
      rel.fromDocId === documentId ? rel.toDocId : rel.fromDocId;
    if (await isNegativeEdge(userId, documentId, peerDocId)) {
      if (rel.status === "proposed") continue;
    }
    const peer = await peerView(userId, peerDocId);
    items.push({
      id: rel.id,
      type: rel.type,
      typeLabel: TYPE_LABELS[rel.type] ?? rel.type,
      score: rel.score,
      confidenceLabel: confidenceLabelFromScore(rel.score),
      status: rel.status,
      message: buildRelationMessage(rel.type, peer, rel.evidence),
      evidence: rel.evidence,
      fromDocId: rel.fromDocId,
      toDocId: rel.toDocId,
      peer,
      snoozedUntil: rel.snoozedUntil,
    });
  }

  items.sort((a, b) => {
    const wa = TYPE_WEIGHT[a.type] ?? 0;
    const wb = TYPE_WEIGHT[b.type] ?? 0;
    if (wb !== wa) return wb - wa;
    return b.score - a.score;
  });

  let sameCategoryCount = 0;
  if (node?.category) {
    sameCategoryCount = (await getDocsByCategory(userId, node.category)).filter(
      (id) => id !== documentId,
    ).length;
  }

  return {
    documentId,
    relationsPhase,
    sameCategoryCount,
    relations: items,
  };
}

async function updateRelationBothSides(
  userId: string,
  documentId: string,
  relation: MemoryRelation,
  patch: Partial<MemoryRelation>,
): Promise<MemoryRelation> {
  const next: MemoryRelation = {
    ...relation,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await upsertRelation(userId, documentId, next);

  const otherDocId =
    next.fromDocId === documentId ? next.toDocId : next.fromDocId;
  const mirror: MemoryRelation = {
    ...next,
    id: next.id,
    fromDocId: otherDocId,
    toDocId: documentId,
  };
  // Preserve mirror id if exists with same key
  await upsertRelation(userId, otherDocId, mirror);

  const edgesA = await listRelationsForDoc(userId, documentId);
  await indexEdgesByDoc(
    userId,
    documentId,
    edgesA.map((r) => r.id),
  );
  const edgesB = await listRelationsForDoc(userId, otherDocId);
  await indexEdgesByDoc(
    userId,
    otherDocId,
    edgesB.map((r) => r.id),
  );

  return next;
}

/**
 * Actions utilisateur → RelationStore + negative cache + indexes.
 */
export async function applyRelationAction(
  userId: string,
  documentId: string,
  relationId: string,
  action: RelationUiAction,
): Promise<RelationListItem> {
  const list = await listRelationsForDoc(userId, documentId);
  const rel = list.find((r) => r.id === relationId);
  if (!rel) {
    throw new AppError("NOT_FOUND", "Relation introuvable.", 404);
  }

  const peerDocId =
    rel.fromDocId === documentId ? rel.toDocId : rel.fromDocId;

  let updated: MemoryRelation;
  if (action === "confirm") {
    await removeNegativeEdge(userId, documentId, peerDocId);
    updated = await updateRelationBothSides(userId, documentId, rel, {
      status: "user_confirmed",
      snoozedUntil: null,
    });
  } else if (action === "dismiss") {
    await addNegativeEdge(userId, documentId, peerDocId, "user_dismissed");
    updated = await updateRelationBothSides(userId, documentId, rel, {
      status: "user_dismissed",
      snoozedUntil: null,
    });
  } else {
    const until = new Date();
    until.setUTCDate(until.getUTCDate() + SNOOZE_DAYS);
    updated = await updateRelationBothSides(userId, documentId, rel, {
      status: "user_snoozed",
      snoozedUntil: until.toISOString(),
    });
  }

  const peer = await peerView(userId, peerDocId);
  return {
    id: updated.id,
    type: updated.type,
    typeLabel: TYPE_LABELS[updated.type] ?? updated.type,
    score: updated.score,
    confidenceLabel: confidenceLabelFromScore(updated.score),
    status: updated.status,
    message: buildRelationMessage(updated.type, peer, updated.evidence),
    evidence: updated.evidence,
    fromDocId: updated.fromDocId,
    toDocId: updated.toDocId,
    peer,
    snoozedUntil: updated.snoozedUntil,
  };
}
