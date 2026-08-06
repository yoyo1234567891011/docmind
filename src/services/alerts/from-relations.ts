import { getMemoryDocument } from "@/services/memory/document-store";
import { listAllRelations } from "@/services/memory/relation-store";
import type { DocumentAlert, AlertKind, AlertSeverity } from "@/types/alerts";
import type { MemoryRelation, MemoryRelationType } from "@/types/memory";

const SCORE_MIN = 0.72;

const TYPE_TO_ALERT: Partial<
  Record<
    MemoryRelationType,
    { kind: AlertKind; severity: AlertSeverity; title: string }
  >
> = {
  duplicate_of: {
    kind: "relation_duplicate",
    severity: "warning",
    title: "Document en doublon",
  },
  supersedes: {
    kind: "relation_supersede",
    severity: "warning",
    title: "Contrat remplacé",
  },
  covers_same_risk: {
    kind: "relation_overlap_risk",
    severity: "warning",
    title: "Risque couvert deux fois",
  },
  same_guarantee: {
    kind: "relation_overlap_risk",
    severity: "warning",
    title: "Garantie déjà présente",
  },
  redundant_payment: {
    kind: "relation_redundant_payment",
    severity: "warning",
    title: "Paiement potentiellement redondant",
  },
  linked_deadline: {
    kind: "relation_deadline_conflict",
    severity: "info",
    title: "Échéances liées",
  },
  contradicts_clause: {
    kind: "relation_contradiction",
    severity: "critical",
    title: "Clauses contradictoires",
  },
  obsoletes_fact: {
    kind: "relation_supersede",
    severity: "warning",
    title: "Fait obsolète",
  },
  amends: {
    kind: "relation_supersede",
    severity: "info",
    title: "Avenant détecté",
  },
  invoice_for: {
    kind: "relation_redundant_payment",
    severity: "info",
    title: "Facture liée à un contrat",
  },
};

function priorityFromSeverity(
  severity: AlertSeverity,
): DocumentAlert["priority"] {
  if (severity === "critical") return "critique";
  if (severity === "warning") return "haute";
  return "moyenne";
}

function messageFor(
  type: MemoryRelationType,
  peerTitle: string,
  evidence: MemoryRelation["evidence"],
): string {
  switch (type) {
    case "duplicate_of":
      return `Ce document semble être un doublon de « ${peerTitle} ».`;
    case "supersedes": {
      const date = evidence.find((e) => e.field === "document_date")?.right;
      return date
        ? `Ce contrat remplace probablement celui du ${date} (${peerTitle}).`
        : `Ce contrat remplace probablement « ${peerTitle} ».`;
    }
    case "covers_same_risk": {
      const risk = evidence.find((e) => e.field === "risk_labels")?.left || "risque";
      return `Deux contrats couvrent le même risque (${risk}) — voir « ${peerTitle} ».`;
    }
    case "same_guarantee":
      return `Cette garantie semble déjà présente dans « ${peerTitle} ».`;
    case "redundant_payment": {
      const amount = evidence.find((e) => e.field === "amount_eur")?.left;
      return amount
        ? `Montant similaire (${amount} €) déjà engagé — voir « ${peerTitle} ».`
        : `Montant similaire déjà engagé auprès de la même contrepartie (« ${peerTitle} »).`;
    }
    case "linked_deadline": {
      const due = evidence.find((e) => e.field === "due_date");
      return due
        ? `Cette échéance (${due.left}) est proche de celle de « ${peerTitle} » (${due.right}).`
        : `Échéance liée à celle de « ${peerTitle} ».`;
    }
    case "contradicts_clause": {
      const clause = evidence.find((e) => e.field === "clause_type")?.left || "clause";
      const why = evidence.find((e) => e.field === "justification")?.left;
      return why
        ? `Contradiction sur « ${clause} » avec « ${peerTitle} » — ${why}.`
        : `Clauses contradictoires avec « ${peerTitle} » (${clause}).`;
    }
    case "obsoletes_fact": {
      const kind = evidence.find((e) => e.field === "fact_kind")?.left || "fait";
      return `Ce document rend obsolète un ${kind} de « ${peerTitle} ».`;
    }
    case "amends":
      return `Avenant probable du contrat « ${peerTitle} ».`;
    case "invoice_for":
      return `Facture probablement liée au contrat « ${peerTitle} ».`;
    default:
      return `Lien détecté avec « ${peerTitle} ».`;
  }
}

/**
 * Convertit les arêtes mémoire (score ≥ seuil) en DocumentAlert relationnelles.
 * Idempotent par relationId + kind.
 */
export async function listRelationAlerts(
  userId: string,
): Promise<DocumentAlert[]> {
  const relations = await listAllRelations(userId);
  const now = new Date().toISOString();
  const out: DocumentAlert[] = [];
  const seen = new Set<string>();

  for (const rel of relations) {
    if (rel.status === "user_dismissed" || rel.status === "user_snoozed") {
      continue;
    }
    if (rel.score < SCORE_MIN) continue;
    const mapping = TYPE_TO_ALERT[rel.type];
    if (!mapping) continue;

    // Une alerte par paire (côté fromDoc) pour éviter le double affichage miroir
    const pairKey = [rel.fromDocId, rel.toDocId].sort().join("|");
    const dedupe = `${mapping.kind}:${pairKey}:${rel.type}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const fromDoc = await getMemoryDocument(userId, rel.fromDocId);
    const toDoc = await getMemoryDocument(userId, rel.toDocId);
    if (!fromDoc?.historyId) continue;

    const peerTitle =
      toDoc?.displayName || toDoc?.fileName || rel.toDocId.slice(0, 8);

    out.push({
      id: `relalert:${dedupe}`,
      kind: mapping.kind,
      severity: mapping.severity,
      priority: priorityFromSeverity(mapping.severity),
      title: mapping.title,
      message: messageFor(rel.type, peerTitle, rel.evidence),
      historyId: fromDoc.historyId,
      documentTitle: fromDoc.displayName || fromDoc.fileName,
      fileName: fromDoc.fileName,
      evidence: rel.evidence.map(
        (e) =>
          `${e.field}: ${e.left}${e.right ? ` → ${e.right}` : ""}${e.note ? ` (${e.note})` : ""}`,
      ),
      date: now.slice(0, 10),
      dueDate:
        rel.type === "linked_deadline"
          ? rel.evidence.find((e) => e.field === "due_date")?.left
          : undefined,
      recommendedAction:
        rel.type === "duplicate_of"
          ? "Vérifier et archiver le doublon"
          : rel.type === "supersedes"
            ? "Confirmer le remplacement du contrat"
            : "Examiner la relation proposée",
      createdAt: rel.createdAt || now,
      read: false,
      dismissed: false,
      relationId: rel.id,
      secondaryHistoryId: toDoc?.historyId ?? null,
    });
  }

  return out;
}
