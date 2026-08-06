/**
 * Détections P3 déterministes (garanties, risques, paiements, échéances).
 * Aucun LLM.
 */
import { randomUUID } from "crypto";

import { listDeadlinesForDoc } from "@/services/memory/deadline-store";
import {
  normalizeEntityKey,
  parseAmountEur,
} from "@/services/memory/normalize";
import {
  loadRelationSignals,
  type DocRelationSignals,
} from "@/services/memory/relation-signals";
import type { HistoryRecord } from "@/types/history";
import type {
  MemoryDeadline,
  MemoryDocumentNode,
  MemoryRelation,
  MemoryRelationEvidence,
} from "@/types/memory";

const GUARANTEE_LEXICON = [
  "incendie",
  "degats des eaux",
  "degat des eaux",
  "vol",
  "bris de glace",
  "responsabilite civile",
  "rc habitation",
  "tous risques",
  "protection juridique",
  "catastrophe naturelle",
  "dommages ouvrage",
  "multirisque",
  "garantie emprunteur",
  "adi",
  "deces",
  "invalidite",
  "perte d emploi",
];

const RISK_LEXICON = [
  "habitation",
  "auto",
  "vehicule",
  "sante",
  "emprunteur",
  "professionnelle",
  "cyber",
  "voyage",
  "animaux",
];

const PERIOD_PATTERNS: Array<{ re: RegExp; key: string }> = [
  { re: /mensuel|par mois|\/mois|chaque mois/i, key: "mensuel" },
  { re: /trimestriel|par trimestre/i, key: "trimestriel" },
  { re: /annuel|par an|\/an|chaque annee|chaque année/i, key: "annuel" },
  { re: /hebdomadaire|par semaine/i, key: "hebdomadaire" },
];

function evidence(
  field: string,
  left: string,
  right: string,
  note?: string,
): MemoryRelationEvidence {
  return { field, left, right, note };
}

function corpusText(record: HistoryRecord | null): string {
  if (!record) return "";
  return [
    record.analysis.title,
    record.analysis.summary,
    ...(record.analysis.important_points ?? []),
    ...(record.analysis.risks ?? []),
    ...(record.analysis.amounts ?? []),
    record.extractedText.slice(0, 4000),
  ].join("\n");
}

export function extractGuaranteeLabels(record: HistoryRecord | null): string[] {
  const text = normalizeEntityKey(corpusText(record));
  const found: string[] = [];
  for (const g of GUARANTEE_LEXICON) {
    if (text.includes(normalizeEntityKey(g))) found.push(g);
  }
  // Explicit "garantie X" patterns
  const raw = corpusText(record);
  const STOP = new Set([
    "incluses",
    "incluse",
    "suivantes",
    "suivante",
    "principales",
    "ci dessous",
  ]);
  for (const m of raw.matchAll(
    /garant(?:ie|ies)\s+([a-zàâäéèêëïîôùûüç][\wàâäéèêëïîôùûüç\s-]{2,40})/gi,
  )) {
    const label = normalizeEntityKey(m[1] || "").slice(0, 40);
    if (label.length >= 3 && !STOP.has(label.split(/\s+/)[0] || "")) {
      found.push(label);
    }
  }
  return [...new Set(found)];
}

export function extractRiskLabels(
  record: HistoryRecord | null,
  category: string,
): string[] {
  const text = normalizeEntityKey(corpusText(record));
  const found: string[] = [];
  for (const r of RISK_LEXICON) {
    if (text.includes(normalizeEntityKey(r))) found.push(r);
  }
  if (category === "assurance" || category === "bail") {
    if (text.includes("habitation") || text.includes("logement")) {
      found.push("habitation");
    }
  }
  if (category === "assurance" && (text.includes("auto") || text.includes("vehicule"))) {
    found.push("auto");
  }
  return [...new Set(found)];
}

export function extractPaymentSignals(record: HistoryRecord | null): {
  amounts: number[];
  period: string | null;
} {
  const amounts = (record?.analysis.amounts ?? [])
    .map(parseAmountEur)
    .filter((n): n is number => n != null && n > 0);
  const text = corpusText(record);
  let period: string | null = null;
  for (const p of PERIOD_PATTERNS) {
    if (p.re.test(text)) {
      period = p.key;
      break;
    }
  }
  return { amounts: [...new Set(amounts.map((a) => Math.round(a * 100) / 100))], period };
}

function amountClose(a: number, b: number, tol = 0.02): boolean {
  if (a <= 0 || b <= 0) return false;
  const diff = Math.abs(a - b) / Math.max(a, b);
  return diff <= tol;
}

function daysBetween(isoA: string, isoB: string): number | null {
  const a = Date.parse(`${isoA}T12:00:00.000Z`);
  const b = Date.parse(`${isoB}T12:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(a - b) / 86400_000;
}

function makeRel(input: {
  userId: string;
  type: MemoryRelation["type"];
  fromDocId: string;
  toDocId: string;
  score: number;
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
    method: "rules",
    evidence: input.evidence,
    status: "proposed",
    createdAt: now,
    updatedAt: now,
  };
}

export function buildRelationSignals(
  record: HistoryRecord,
  category: string,
): DocRelationSignals {
  const pay = extractPaymentSignals(record);
  return {
    documentId: record.documentId,
    category,
    title: record.displayName || record.analysis.title || record.fileName,
    guaranteeLabels: extractGuaranteeLabels(record),
    riskLabels: extractRiskLabels(record, category),
    amounts: pay.amounts,
    period: pay.period,
    updatedAt: new Date().toISOString(),
  };
}

async function resolveSignals(
  userId: string,
  node: MemoryDocumentNode,
  record: HistoryRecord | null,
): Promise<DocRelationSignals> {
  if (record) return buildRelationSignals(record, node.category);
  const saved = await loadRelationSignals(userId, node.documentId);
  if (saved) return saved;
  return {
    documentId: node.documentId,
    category: node.category,
    title: node.displayName || node.fileName,
    guaranteeLabels: [],
    riskLabels: [],
    amounts: [],
    period: null,
    updatedAt: node.updatedAt,
  };
}

/**
 * Détections P3 pour une paire de documents.
 * Utilise l’historique si dispo, sinon les signaux mémoire persistés.
 */
export async function detectP3Relations(input: {
  userId: string;
  source: MemoryDocumentNode;
  candidate: MemoryDocumentNode;
  sourceRecord: HistoryRecord;
  candidateRecord: HistoryRecord | null;
  sharedEntityIds: string[];
}): Promise<MemoryRelation[]> {
  const {
    userId,
    source,
    candidate,
    sourceRecord,
    candidateRecord,
    sharedEntityIds,
  } = input;
  const out: MemoryRelation[] = [];
  const sharedEntity = sharedEntityIds[0] ?? null;

  const [sigA, sigB] = await Promise.all([
    resolveSignals(userId, source, sourceRecord),
    resolveSignals(userId, candidate, candidateRecord),
  ]);

  const gA = sigA.guaranteeLabels;
  const gB = sigB.guaranteeLabels;
  const overlapG = gA.filter((g) => gB.includes(g));

  const rA = sigA.riskLabels;
  const rB = sigB.riskLabels;
  const overlapR = rA.filter((r) => rB.includes(r));

  const bothInsuranceLike =
    (source.category === "assurance" || source.category === "banque") &&
    (candidate.category === "assurance" || candidate.category === "banque");

  // same_guarantee
  if (overlapG.length > 0 && bothInsuranceLike) {
    out.push(
      makeRel({
        userId,
        type: "same_guarantee",
        fromDocId: source.documentId,
        toDocId: candidate.documentId,
        score: Math.min(0.92, 0.7 + overlapG.length * 0.05),
        evidence: [
          evidence(
            "guarantee_labels",
            overlapG.join(", "),
            overlapG.join(", "),
            "Garanties normalisées identiques",
          ),
          evidence("category", source.category, candidate.category),
          ...(sharedEntity
            ? [
                evidence(
                  "entity_id",
                  sharedEntity,
                  sharedEntity,
                  "Contrepartie partagée",
                ),
              ]
            : []),
        ],
        fromNode: sharedEntity
          ? { kind: "entity", id: sharedEntity }
          : undefined,
      }),
    );
  }

  // covers_same_risk
  if (
    overlapR.length > 0 &&
    bothInsuranceLike &&
    (sharedEntity || overlapG.length > 0 || overlapR.length >= 2)
  ) {
    out.push(
      makeRel({
        userId,
        type: "covers_same_risk",
        fromDocId: source.documentId,
        toDocId: candidate.documentId,
        score: Math.min(
          0.9,
          0.65 + overlapR.length * 0.08 + (sharedEntity ? 0.1 : 0),
        ),
        evidence: [
          evidence(
            "risk_labels",
            overlapR.join(", "),
            overlapR.join(", "),
            "Couverture de risque chevauchante",
          ),
          evidence("category", source.category, candidate.category),
          ...(overlapG.length
            ? [
                evidence(
                  "guarantee_overlap",
                  overlapG.join(", "),
                  String(overlapG.length),
                ),
              ]
            : []),
          ...(sharedEntity
            ? [evidence("entity_id", sharedEntity, sharedEntity)]
            : []),
        ],
        fromNode: sharedEntity
          ? { kind: "entity", id: sharedEntity }
          : undefined,
      }),
    );
  }

  // redundant_payment
  let bestPair: { a: number; b: number } | null = null;
  for (const a of sigA.amounts) {
    for (const b of sigB.amounts) {
      if (amountClose(a, b, 0.02)) {
        bestPair = { a, b };
        break;
      }
    }
    if (bestPair) break;
  }
  const periodMatch =
    sigA.period && sigB.period && sigA.period === sigB.period;
  const paymentCategories = new Set([
    "facture",
    "assurance",
    "banque",
    "contrat",
    "autre",
  ]);
  if (
    bestPair &&
    sharedEntity &&
    paymentCategories.has(source.category) &&
    paymentCategories.has(candidate.category) &&
    (periodMatch || source.category === "facture" || candidate.category === "facture")
  ) {
    out.push(
      makeRel({
        userId,
        type: "redundant_payment",
        fromDocId: source.documentId,
        toDocId: candidate.documentId,
        score: periodMatch ? 0.88 : 0.78,
        evidence: [
          evidence(
            "amount_eur",
            String(bestPair.a),
            String(bestPair.b),
            "Montants égaux à ±2%",
          ),
          evidence(
            "periodicity",
            sigA.period || "inconnue",
            sigB.period || "inconnue",
            periodMatch ? "Périodicité identique" : "Périodicité partielle",
          ),
          evidence(
            "entity_id",
            sharedEntity,
            sharedEntity,
            "Même contrepartie",
          ),
        ],
        fromNode: { kind: "entity", id: sharedEntity },
        toNode: { kind: "entity", id: sharedEntity },
      }),
    );
  }

  // linked_deadline
  const [dA, dB] = await Promise.all([
    listDeadlinesForDoc(userId, source.documentId),
    listDeadlinesForDoc(userId, candidate.documentId),
  ]);
  let bestDeadline: {
    left: MemoryDeadline;
    right: MemoryDeadline;
    gap: number;
  } | null = null;
  for (const left of dA) {
    if (!left.dueDate) continue;
    for (const right of dB) {
      if (!right.dueDate) continue;
      const gap = daysBetween(left.dueDate, right.dueDate);
      if (gap == null || gap > 7) continue;
      const entityOk =
        !sharedEntity ||
        left.entityId === sharedEntity ||
        right.entityId === sharedEntity ||
        left.entityId === right.entityId;
      if (!entityOk && gap > 3) continue;
      if (!bestDeadline || gap < bestDeadline.gap) {
        bestDeadline = { left, right, gap };
      }
    }
  }
  if (bestDeadline) {
    const clusterHint =
      bestDeadline.left.clusterId ||
      bestDeadline.right.clusterId ||
      null;
    out.push(
      makeRel({
        userId,
        type: "linked_deadline",
        fromDocId: source.documentId,
        toDocId: candidate.documentId,
        score: Math.min(0.9, 0.75 + (7 - bestDeadline.gap) * 0.02),
        evidence: [
          evidence(
            "due_date",
            bestDeadline.left.dueDate || "",
            bestDeadline.right.dueDate || "",
            `Écart ${Math.round(bestDeadline.gap)} j (seuil ±7)`,
          ),
          evidence(
            "deadline_kind",
            bestDeadline.left.kind,
            bestDeadline.right.kind,
          ),
          evidence(
            "deadline_label",
            bestDeadline.left.label.slice(0, 80),
            bestDeadline.right.label.slice(0, 80),
          ),
          ...(clusterHint
            ? [evidence("cluster_id", clusterHint, clusterHint)]
            : []),
          ...(sharedEntity
            ? [evidence("entity_id", sharedEntity, sharedEntity)]
            : []),
        ],
        fromNode: { kind: "deadline", id: bestDeadline.left.id },
        toNode: { kind: "deadline", id: bestDeadline.right.id },
      }),
    );
  }

  return out.filter((r) => r.evidence.length >= 1);
}
