/**
 * Déduplication abonnements — lecture seule, sans LLM.
 * 1 abonnement réel = 1 ligne ; jamais sommer plusieurs docs du même abo.
 */
import {
  amountsClose,
  resolveProductSignal,
  type ProductSignal,
} from "@/services/insights/subscription-identity";
import type { DocRelationSignals } from "@/services/memory/relation-signals";
import type { MemoryDocumentNode, MemoryRelation } from "@/types/memory";

/** Relations qui fusionnent des docs vers une seule ligne d’abonnement. */
const MERGE_RELATION_TYPES = new Set<MemoryRelation["type"]>([
  "duplicate_of",
  "supersedes",
  "same_contract_family",
  "covers_same_risk",
  "linked_deadline",
  "invoice_for",
  "redundant_payment",
  "amends",
]);

const CONTRACT_CATEGORIES = new Set([
  "contrat",
  "assurance",
  "banque",
  "bail",
]);

export type DocSpendSnapshot = {
  doc: MemoryDocumentNode;
  signals: DocRelationSignals | null;
  monthly: number | null;
  period: string | null;
  product: ProductSignal;
};

class UnionFind {
  private parent = new Map<string, string>();

  constructor(ids: string[]) {
    for (const id of ids) this.parent.set(id, id);
  }

  find(id: string): string {
    let root = id;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    let cur = id;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }

  components(): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      const list = groups.get(root) ?? [];
      list.push(id);
      groups.set(root, list);
    }
    return groups;
  }
}

export function relationMergesSubscription(rel: MemoryRelation): boolean {
  if (rel.status === "user_dismissed" || rel.status === "user_snoozed") {
    return false;
  }
  if (!MERGE_RELATION_TYPES.has(rel.type)) return false;
  if (rel.type === "duplicate_of" && rel.score < 0.9) return false;
  return rel.score >= 0.72;
}

function productsConflict(a: ProductSignal, b: ProductSignal): boolean {
  if (a.key === b.key) return false;
  if (a.key === "default" || b.key === "default") return false;
  return true;
}

function canHeuristicMerge(
  left: DocSpendSnapshot,
  right: DocSpendSnapshot,
): boolean {
  if (productsConflict(left.product, right.product)) return false;

  const leftMonthly = left.monthly;
  const rightMonthly = right.monthly;
  const amountsCompatible =
    leftMonthly != null &&
    rightMonthly != null &&
    amountsClose(leftMonthly, rightMonthly);

  const leftFacture = left.doc.category === "facture";
  const rightFacture = right.doc.category === "facture";
  const leftContract = CONTRACT_CATEGORIES.has(left.doc.category);
  const rightContract = CONTRACT_CATEGORIES.has(right.doc.category);
  const invoiceContractPair =
    (leftFacture && rightContract) || (rightFacture && leftContract);

  if (invoiceContractPair && amountsCompatible) return true;

  if (
    invoiceContractPair &&
    left.period &&
    right.period &&
    left.period === right.period
  ) {
    return true;
  }

  if (
    left.product.key === right.product.key &&
    left.product.key !== "default" &&
    amountsCompatible
  ) {
    return true;
  }

  // Même produit identifié + même périodicité → un seul abo (montant = doc le plus fiable).
  if (
    left.product.key === right.product.key &&
    left.product.key !== "default" &&
    left.period &&
    right.period &&
    left.period === right.period
  ) {
    return true;
  }

  if (
    left.product.key === "default" &&
    right.product.key === "default" &&
    amountsCompatible &&
    left.period &&
    right.period
  ) {
    return true;
  }

  return false;
}

/**
 * Regroupe les documents d’une contrepartie en composantes (1 abo = 1 composante).
 */
export function clusterSubscriptionDocs(input: {
  docs: MemoryDocumentNode[];
  relations: MemoryRelation[];
  snapshots: Map<string, DocSpendSnapshot>;
}): MemoryDocumentNode[][] {
  const { docs, relations, snapshots } = input;
  if (docs.length === 0) return [];
  if (docs.length === 1) return [docs];

  const docIds = new Set(docs.map((d) => d.documentId));
  const uf = new UnionFind([...docIds]);

  for (const rel of relations) {
    if (!relationMergesSubscription(rel)) continue;
    if (!docIds.has(rel.fromDocId) || !docIds.has(rel.toDocId)) continue;
    const snapA = snapshots.get(rel.fromDocId);
    const snapB = snapshots.get(rel.toDocId);
    if (snapA && snapB && productsConflict(snapA.product, snapB.product)) {
      continue;
    }
    uf.union(rel.fromDocId, rel.toDocId);
  }

  const ordered = [...docs].sort((a, b) =>
    a.documentId.localeCompare(b.documentId),
  );
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i]!;
    const snapA = snapshots.get(a.documentId);
    if (!snapA) continue;
    for (let j = i + 1; j < ordered.length; j++) {
      const b = ordered[j]!;
      const snapB = snapshots.get(b.documentId);
      if (!snapB) continue;
      if (canHeuristicMerge(snapA, snapB)) {
        uf.union(a.documentId, b.documentId);
      }
    }
  }

  const byId = new Map(docs.map((d) => [d.documentId, d]));
  const components: MemoryDocumentNode[][] = [];
  for (const ids of uf.components().values()) {
    const group = ids
      .map((id) => byId.get(id))
      .filter((d): d is MemoryDocumentNode => d != null);
    if (group.length > 0) components.push(group);
  }
  return components;
}

const CATEGORY_PRIORITY: Record<string, number> = {
  contrat: 5,
  assurance: 5,
  bail: 4,
  banque: 3,
  facture: 1,
};

/**
 * Document source pour le montant affiché : contrat > facture, éligible > remplacé, récent.
 */
export function pickPrimarySubscriptionDoc(
  docs: MemoryDocumentNode[],
  isEligible: (doc: MemoryDocumentNode) => boolean,
): MemoryDocumentNode {
  const ranked = [...docs].sort((a, b) => {
    const eligA = isEligible(a) ? 1 : 0;
    const eligB = isEligible(b) ? 1 : 0;
    if (eligB !== eligA) return eligB - eligA;
    const catA = CATEGORY_PRIORITY[a.category] ?? 0;
    const catB = CATEGORY_PRIORITY[b.category] ?? 0;
    if (catB !== catA) return catB - catA;
    return b.analyzedAt.localeCompare(a.analyzedAt);
  });
  return ranked[0]!;
}

/** Produit affiché pour une composante fusionnée (ex. facture + contrat fibre). */
export function resolveComponentProduct(
  docs: MemoryDocumentNode[],
  snapshots: Map<string, DocSpendSnapshot>,
  orgName: string,
  primary: MemoryDocumentNode,
): ProductSignal {
  const nonDefault = new Map<string, ProductSignal>();
  for (const doc of docs) {
    const snap =
      snapshots.get(doc.documentId) ??
      ({
        product: resolveProductSignal(doc, null, orgName),
      } as DocSpendSnapshot);
    if (snap.product.key !== "default") {
      nonDefault.set(snap.product.key, snap.product);
    }
  }
  if (nonDefault.size === 1) {
    return [...nonDefault.values()][0]!;
  }
  return (
    snapshots.get(primary.documentId)?.product ??
    resolveProductSignal(
      primary,
      snapshots.get(primary.documentId)?.signals ?? null,
      orgName,
    )
  );
}

export function buildDocSpendSnapshot(
  doc: MemoryDocumentNode,
  signals: DocRelationSignals | null,
  orgName: string,
  monthly: number | null,
  period: string | null,
): DocSpendSnapshot {
  return {
    doc,
    signals,
    monthly,
    period,
    product: resolveProductSignal(doc, signals, orgName),
  };
}
