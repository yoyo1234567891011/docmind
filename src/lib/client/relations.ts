import type { ApiResponse } from "@/types";
import type { MemoryRelationEvidence, MemoryRelationType } from "@/types/memory";

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
  status: string;
  message: string;
  evidence: MemoryRelationEvidence[];
  fromDocId: string;
  toDocId: string;
  peer: RelationPeerView;
  snoozedUntil?: string | null;
}

export interface RelationsUiPayload {
  documentId: string;
  relationsPhase: "pending" | "ready" | "failed";
  sameCategoryCount: number;
  relations: RelationListItem[];
}

export async function fetchDocumentRelations(
  documentId: string,
): Promise<RelationsUiPayload> {
  const response = await fetch(
    `/api/documents/${encodeURIComponent(documentId)}/relations`,
    { cache: "no-store" },
  );
  const payload = (await response.json()) as ApiResponse<RelationsUiPayload>;
  if (!payload.success) throw new Error(payload.error.message);
  return payload.data;
}

export async function applyDocumentRelationAction(
  documentId: string,
  relationId: string,
  action: RelationUiAction,
): Promise<RelationListItem> {
  const response = await fetch(
    `/api/documents/${encodeURIComponent(documentId)}/relations`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relationId, action }),
    },
  );
  const payload = (await response.json()) as ApiResponse<{
    relation: RelationListItem;
  }>;
  if (!payload.success) throw new Error(payload.error.message);
  return payload.data.relation;
}
