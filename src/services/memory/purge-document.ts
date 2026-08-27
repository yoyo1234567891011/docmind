import { removeDocFromFamilies } from "@/services/memory/contract-family";
import { deleteClausesForDoc } from "@/services/memory/clause-store";
import {
  deleteDeadlinesForDoc,
  listDeadlinesForDoc,
} from "@/services/memory/deadline-store";
import { deleteMemoryDocument } from "@/services/memory/document-store";
import { listEntities, unlinkEntityDoc } from "@/services/memory/entity-store";
import {
  removeDocFromIndexes,
  unindexEntityDoc,
} from "@/services/memory/indexes";
import { removeNegativeEdgesForDoc } from "@/services/memory/negative-edges";
import {
  deleteRelationsForDoc,
  listAllRelations,
  listRelationsForDoc,
  saveRelationsForDoc,
} from "@/services/memory/relation-store";
import { deleteRelationSignals } from "@/services/memory/relation-signals";
import type { MemoryRelation } from "@/types/memory";

function isUserTouchedRelation(r: MemoryRelation): boolean {
  return (
    r.status === "user_confirmed" ||
    r.status === "user_dismissed" ||
    r.status === "user_snoozed"
  );
}

/**
 * Remplace les données dérivées d’un document avant réindexation.
 *
 * Principes :
 * - ne concerne QUE ce document (+ miroirs de relations auto vers lui) ;
 * - ne touche pas aux paires indépendantes (ex. C↔D) ;
 * - conserve les relations explicitement tranchées par l’utilisateur ;
 * - ne supprime pas le nœud document (réécrit ensuite par l’upsert).
 */
export async function clearDerivedMemoryForReindex(
  userId: string,
  documentId: string,
): Promise<{ keptUserRelations: MemoryRelation[] }> {
  const previousRels = await listRelationsForDoc(userId, documentId);
  const keptUserRelations = previousRels.filter(isUserTouchedRelation);

  const entities = await listEntities(userId);
  for (const entity of entities) {
    if (entity.docIds.includes(documentId)) {
      await unindexEntityDoc(userId, entity.id, documentId);
    }
  }
  await unlinkEntityDoc(userId, documentId);

  await deleteClausesForDoc(userId, documentId);
  const deadlines = await listDeadlinesForDoc(userId, documentId);
  const deadlineIds = deadlines.map((d) => d.id);
  await deleteDeadlinesForDoc(userId, documentId);

  await deleteRelationSignals(userId, documentId);
  await removeDocFromFamilies(userId, documentId);
  await removeDocFromIndexes(userId, documentId, { deadlineIds });

  // Relations auto/proposed de CE document + miroirs chez les pairs.
  const peerDocIds = new Set<string>();
  for (const rel of await listAllRelations(userId)) {
    if (rel.fromDocId === documentId) peerDocIds.add(rel.toDocId);
    if (rel.toDocId === documentId) peerDocIds.add(rel.fromDocId);
  }
  peerDocIds.delete(documentId);

  await saveRelationsForDoc(userId, documentId, keptUserRelations);

  for (const peerId of peerDocIds) {
    const existing = await listRelationsForDoc(userId, peerId);
    const filtered = existing.filter((r) => {
      const involves = r.fromDocId === documentId || r.toDocId === documentId;
      if (!involves) return true;
      return isUserTouchedRelation(r);
    });
    if (filtered.length !== existing.length) {
      await saveRelationsForDoc(userId, peerId, filtered);
    }
  }

  return { keptUserRelations };
}

/** Nettoie le graphe pour un document supprimé (history delete). */
export async function purgeMemoryForDocument(
  userId: string,
  documentId: string,
): Promise<void> {
  const entities = await listEntities(userId);
  for (const entity of entities) {
    if (entity.docIds.includes(documentId)) {
      await unindexEntityDoc(userId, entity.id, documentId);
    }
  }
  await unlinkEntityDoc(userId, documentId);
  await deleteClausesForDoc(userId, documentId);
  const deadlines = await listDeadlinesForDoc(userId, documentId);
  const deadlineIds = deadlines.map((d) => d.id);
  await deleteDeadlinesForDoc(userId, documentId);
  await deleteRelationsForDoc(userId, documentId);
  await deleteMemoryDocument(userId, documentId);
  await removeDocFromIndexes(userId, documentId, { deadlineIds });
  await deleteRelationSignals(userId, documentId);
  await removeNegativeEdgesForDoc(userId, documentId);
  await removeDocFromFamilies(userId, documentId);

  // Retire les arêtes chez les pairs qui pointent vers ce document
  const peerDocIds = new Set<string>();
  for (const rel of await listAllRelations(userId)) {
    if (rel.fromDocId === documentId) peerDocIds.add(rel.toDocId);
    if (rel.toDocId === documentId) peerDocIds.add(rel.fromDocId);
  }
  peerDocIds.delete(documentId);
  for (const peerId of peerDocIds) {
    const existing = await listRelationsForDoc(userId, peerId);
    const filtered = existing.filter(
      (r) => r.fromDocId !== documentId && r.toDocId !== documentId,
    );
    if (filtered.length !== existing.length) {
      await saveRelationsForDoc(userId, peerId, filtered);
    }
  }
}
