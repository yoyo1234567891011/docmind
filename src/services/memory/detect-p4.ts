/**
 * Détections P4 déterministes — contradictions, faits obsolètes, avenants, factures.
 * Aucun LLM sur le chemin critique.
 */
import { randomUUID } from "crypto";

import { listClausesForDoc } from "@/services/memory/clause-store";
import {
  loadRelationSignals,
  type DocRelationSignals,
} from "@/services/memory/relation-signals";
import { normalizeEntityKey, parseAmountEur } from "@/services/memory/normalize";
import type { HistoryRecord } from "@/types/history";
import type {
  MemoryClause,
  MemoryDocumentNode,
  MemoryRelation,
  MemoryRelationEvidence,
} from "@/types/memory";

function evidence(
  field: string,
  left: string,
  right: string,
  note?: string,
): MemoryRelationEvidence {
  return { field, left, right, note };
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

function valuesConflict(
  a: string | number | boolean | null,
  b: string | number | boolean | null,
): { conflict: boolean; justification: string } {
  if (a == null || b == null) return { conflict: false, justification: "" };
  if (typeof a === "boolean" && typeof b === "boolean") {
    return a !== b
      ? {
          conflict: true,
          justification: `Valeurs booléennes opposées (${String(a)} vs ${String(b)})`,
        }
      : { conflict: false, justification: "" };
  }
  if (typeof a === "number" && typeof b === "number") {
    const base = Math.max(Math.abs(a), Math.abs(b), 1);
    const rel = Math.abs(a - b) / base;
    const abs = Math.abs(a - b);
    if (rel >= 0.15 || abs >= 7) {
      return {
        conflict: true,
        justification: `Écart significatif (${a} vs ${b}, Δrel=${(rel * 100).toFixed(0)}%)`,
      };
    }
    return { conflict: false, justification: "" };
  }
  const sa = normalizeEntityKey(String(a));
  const sb = normalizeEntityKey(String(b));
  if (sa && sb && sa !== sb) {
    return {
      conflict: true,
      justification: `Valeurs textuelles distinctes (« ${String(a).slice(0, 40)} » vs « ${String(b).slice(0, 40)} »)`,
    };
  }
  return { conflict: false, justification: "" };
}

function extractAddress(text: string): string | null {
  const m = text.match(
    /(?:adresse(?:\s+(?:du\s+risque|d['']installation|de\s+facturation))?|domicile|lieu\s+d['']habitation)\s*[:\-]?\s*([^\n.]{8,90})/i,
  );
  if (!m?.[1]) return null;
  return normalizeEntityKey(m[1]).slice(0, 80) || null;
}

function extractTariffHint(record: HistoryRecord | null, signals: DocRelationSignals | null): number | null {
  if (signals?.amounts?.[0] != null) return signals.amounts[0];
  const fromAnalysis = (record?.analysis.amounts ?? [])
    .map(parseAmountEur)
    .find((n): n is number => n != null && n > 0);
  return fromAnalysis ?? null;
}

function corpusLite(record: HistoryRecord | null, node: MemoryDocumentNode): string {
  if (record) {
    return [
      record.analysis.title,
      record.analysis.summary,
      ...(record.analysis.important_points ?? []),
      record.extractedText.slice(0, 3000),
    ].join("\n");
  }
  return `${node.displayName || ""} ${node.fileName}`;
}

function hasAmendSignal(text: string, title: string): boolean {
  return /avenant|amendement|modification\s+(du|de\s+la)\s+contrat|clause\s+modificative/i.test(
    `${title}\n${text}`,
  );
}

function daysBetweenIso(a: string, b: string): number | null {
  const ta = Date.parse(a.length <= 10 ? `${a}T12:00:00.000Z` : a);
  const tb = Date.parse(b.length <= 10 ? `${b}T12:00:00.000Z` : b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.abs(ta - tb) / 86400_000;
}

function amountClose(a: number, b: number, tol = 0.05): boolean {
  if (a <= 0 || b <= 0) return false;
  return Math.abs(a - b) / Math.max(a, b) <= tol;
}

function findContradictingPair(
  left: MemoryClause[],
  right: MemoryClause[],
): {
  a: MemoryClause;
  b: MemoryClause;
  justification: string;
} | null {
  for (const a of left) {
    if (a.clauseType === "autre") continue;
    for (const b of right) {
      if (b.clauseType !== a.clauseType) continue;
      const check = valuesConflict(
        a.normalizedValue ?? null,
        b.normalizedValue ?? null,
      );
      if (check.conflict) {
        return { a, b, justification: check.justification };
      }
      // Tacite explicite dans le texte même sans normalizedValue
      if (a.clauseType === "tacite") {
        const aYes = /tacite|reconduction automatique/i.test(a.textSpan);
        const aNo = /sans tacite|pas de reconduction|non reconduit/i.test(a.textSpan);
        const bYes = /tacite|reconduction automatique/i.test(b.textSpan);
        const bNo = /sans tacite|pas de reconduction|non reconduit/i.test(b.textSpan);
        if ((aYes && bNo) || (aNo && bYes)) {
          return {
            a,
            b,
            justification: "Tacite reconduction affirmée d’un côté, niée de l’autre",
          };
        }
      }
    }
  }
  return null;
}

/**
 * Détections P4 pour une paire — rules only.
 */
export async function detectP4Relations(input: {
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
  const sameCategory = source.category === candidate.category;

  const [clausesA, clausesB, sigA, sigB] = await Promise.all([
    listClausesForDoc(userId, source.documentId),
    listClausesForDoc(userId, candidate.documentId),
    loadRelationSignals(userId, source.documentId),
    loadRelationSignals(userId, candidate.documentId),
  ]);

  // --- contradicts_clause ---
  if (sharedEntity || sameCategory) {
    const pair = findContradictingPair(clausesA, clausesB);
    if (pair) {
      const score = Math.min(
        0.94,
        0.72 + (sharedEntity ? 0.12 : 0.04) + (sameCategory ? 0.06 : 0),
      );
      out.push(
        makeRel({
          userId,
          type: "contradicts_clause",
          fromDocId: source.documentId,
          toDocId: candidate.documentId,
          score,
          evidence: [
            evidence(
              "clause_type",
              pair.a.clauseType,
              pair.b.clauseType,
              "Même type de clause, valeurs incompatibles",
            ),
            evidence(
              "normalized_value",
              String(pair.a.normalizedValue ?? ""),
              String(pair.b.normalizedValue ?? ""),
              pair.justification,
            ),
            evidence(
              "citation",
              pair.a.textSpan.slice(0, 160),
              pair.b.textSpan.slice(0, 160),
              "Extraits de clauses comparés",
            ),
            evidence(
              "justification",
              pair.justification,
              "",
              "Règle déterministe P4",
            ),
            ...(sharedEntity
              ? [evidence("entity_id", sharedEntity, sharedEntity)]
              : []),
          ],
          fromNode: { kind: "clause", id: pair.a.id },
          toNode: { kind: "clause", id: pair.b.id },
        }),
      );
    }
  }

  // --- amends ---
  const textA = corpusLite(sourceRecord, source);
  const textB = corpusLite(candidateRecord, candidate);
  const titleA = sourceRecord.displayName || sourceRecord.analysis.title || source.fileName;
  const titleB =
    candidateRecord?.displayName ||
    candidateRecord?.analysis.title ||
    candidate.displayName ||
    candidate.fileName;
  const amendA = hasAmendSignal(textA, titleA);
  const amendB = hasAmendSignal(textB, titleB);
  if (
    sharedEntity &&
    sameCategory &&
    (amendA || amendB) &&
    source.category !== "facture"
  ) {
    const newerIsSource =
      Date.parse(source.analyzedAt) >= Date.parse(candidate.analyzedAt);
    const fromDoc = amendA || newerIsSource ? source.documentId : candidate.documentId;
    const toDoc = fromDoc === source.documentId ? candidate.documentId : source.documentId;
    out.push(
      makeRel({
        userId,
        type: "amends",
        fromDocId: fromDoc,
        toDocId: toDoc,
        score: 0.82,
        evidence: [
          evidence(
            "amend_signal",
            amendA ? titleA.slice(0, 80) : "—",
            amendB ? titleB.slice(0, 80) : "—",
            "Motif avenant / modification détecté",
          ),
          evidence("category", source.category, candidate.category),
          evidence("entity_id", sharedEntity, sharedEntity, "Même contrepartie"),
          evidence(
            "citation",
            (amendA ? textA : textB).slice(0, 160),
            (amendA ? textB : textA).slice(0, 160),
          ),
          evidence(
            "justification",
            "Document modificatif probable du contrat de base",
            "",
            "Règle déterministe P4",
          ),
        ],
        fromNode: { kind: "entity", id: sharedEntity },
      }),
    );
  }

  // --- invoice_for ---
  const cats = new Set([source.category, candidate.category]);
  const hasInvoice = cats.has("facture");
  const hasContract = ["contrat", "assurance", "bail", "banque"].some((c) =>
    cats.has(c),
  );
  if (hasInvoice && hasContract && sharedEntity) {
    const invoiceIsSource = source.category === "facture";
    const invoiceDoc = invoiceIsSource ? source : candidate;
    const contractDoc = invoiceIsSource ? candidate : source;
    const invSig = invoiceIsSource ? sigA : sigB;
    const ctrSig = invoiceIsSource ? sigB : sigA;
    const invAmt = invSig?.amounts?.[0] ?? null;
    const ctrAmt = ctrSig?.amounts?.[0] ?? null;
    const amountOk =
      invAmt != null && ctrAmt != null && amountClose(invAmt, ctrAmt, 0.05);
    const gap = daysBetweenIso(invoiceDoc.analyzedAt, contractDoc.analyzedAt);
    const dateOk = gap != null && gap <= 45;
    if (amountOk || dateOk) {
      out.push(
        makeRel({
          userId,
          type: "invoice_for",
          fromDocId: invoiceDoc.documentId,
          toDocId: contractDoc.documentId,
          score: amountOk && dateOk ? 0.9 : amountOk ? 0.84 : 0.76,
          evidence: [
            evidence(
              "category_pair",
              invoiceDoc.category,
              contractDoc.category,
              "Facture liée à un contrat",
            ),
            evidence("entity_id", sharedEntity, sharedEntity, "Même contrepartie"),
            ...(invAmt != null && ctrAmt != null
              ? [
                  evidence(
                    "amount_eur",
                    String(invAmt),
                    String(ctrAmt),
                    amountOk ? "Montants proches ±5%" : "Montants divergents",
                  ),
                ]
              : []),
            ...(gap != null
              ? [
                  evidence(
                    "date_gap_days",
                    String(Math.round(gap)),
                    "≤45",
                    dateOk ? "Proximité temporelle" : "Écart temporel large",
                  ),
                ]
              : []),
            evidence(
              "justification",
              amountOk
                ? "Montant facture compatible avec le contrat"
                : "Facture récente pour la même contrepartie",
              "",
              "Règle déterministe P4",
            ),
          ],
          fromNode: { kind: "entity", id: sharedEntity },
          toNode: { kind: "document", id: contractDoc.documentId },
        }),
      );
    }
  }

  // --- obsoletes_fact ---
  if (sharedEntity && sameCategory) {
    const newer =
      Date.parse(source.analyzedAt) >= Date.parse(candidate.analyzedAt)
        ? { node: source, record: sourceRecord as HistoryRecord | null, sig: sigA }
        : {
            node: candidate,
            record: candidateRecord,
            sig: sigB,
          };
    const older =
      newer.node.documentId === source.documentId
        ? {
            node: candidate,
            record: candidateRecord,
            sig: sigB,
          }
        : {
            node: source,
            record: sourceRecord as HistoryRecord | null,
            sig: sigA,
          };

    if (newer.node.documentId !== older.node.documentId) {
      const addrNew = extractAddress(corpusLite(newer.record, newer.node));
      const addrOld = extractAddress(corpusLite(older.record, older.node));
      const tariffNew = extractTariffHint(newer.record, newer.sig);
      const tariffOld = extractTariffHint(older.record, older.sig);

      const addressObsolete =
        addrNew &&
        addrOld &&
        addrNew !== addrOld &&
        addrNew.length >= 8 &&
        addrOld.length >= 8;
      const tariffObsolete =
        tariffNew != null &&
        tariffOld != null &&
        !amountClose(tariffNew, tariffOld, 0.02) &&
        Math.abs(tariffNew - tariffOld) / Math.max(tariffNew, tariffOld) >= 0.05;

      if (addressObsolete || tariffObsolete) {
        const factField = addressObsolete ? "address" : "tariff";
        const left = addressObsolete ? addrNew! : String(tariffNew);
        const right = addressObsolete ? addrOld! : String(tariffOld);
        out.push(
          makeRel({
            userId,
            type: "obsoletes_fact",
            fromDocId: newer.node.documentId,
            toDocId: older.node.documentId,
            score: addressObsolete ? 0.86 : 0.8,
            evidence: [
              evidence(
                "fact_kind",
                factField,
                factField,
                addressObsolete
                  ? "Adresse / lieu remplacé"
                  : "Tarif / cotisation remplacé",
              ),
              evidence(
                "fact_value",
                left,
                right,
                "Valeur récente → ancienne",
              ),
              evidence(
                "citation",
                corpusLite(newer.record, newer.node).slice(0, 140),
                corpusLite(older.record, older.node).slice(0, 140),
              ),
              evidence("entity_id", sharedEntity, sharedEntity),
              evidence(
                "document_date",
                newer.node.analyzedAt.slice(0, 10),
                older.node.analyzedAt.slice(0, 10),
                "Document plus récent rend le fait antérieur obsolète",
              ),
              evidence(
                "justification",
                addressObsolete
                  ? "Nouvelle adresse détectée sur le document plus récent"
                  : "Nouveau tarif détecté sur le document plus récent",
                "",
                "Règle déterministe P4",
              ),
            ],
            fromNode: { kind: "document", id: newer.node.documentId },
            toNode: { kind: "document", id: older.node.documentId },
          }),
        );
      }
    }
  }

  return out.filter((r) => r.evidence.length >= 1);
}
