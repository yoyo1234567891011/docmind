/**
 * Corpus P3 — garanties / risques / paiements / échéances + clusters + alertes.
 * Mesure précision + budgets CandidateSelector / RelationEngine.
 * Sans LLM.
 */
import assert from "assert";
import { rm } from "fs/promises";

import { userDataDir } from "../src/config/paths";
import { listRelationAlerts } from "../src/services/alerts/from-relations";
import {
  ensureUserWorkspace,
  resetUserWorkspaceCache,
} from "../src/services/auth/workspace";
import {
  listDeadlinesForDoc,
  listRelationsForDoc,
  MAX_CANDIDATES,
  upsertMemoryFromHistoryRecord,
} from "../src/services/memory";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import type { HistoryRecord } from "../src/types";
import { EMPTY_READY_REPLY } from "../src/types/reply";

type ExpectedType =
  | "covers_same_risk"
  | "same_guarantee"
  | "redundant_payment"
  | "linked_deadline"
  | "none";

interface CorpusCase {
  id: string;
  label: string;
  expectWith: string;
  expect: ExpectedType | ExpectedType[];
}

function baseAnalysis(overrides: Partial<HistoryRecord["analysis"]> = {}) {
  return {
    document_type: "Contrat",
    title: "Contrat",
    summary: "Résumé",
    date: "01/01/2024",
    dates: ["01/01/2024"],
    people: [] as string[],
    organizations: [] as string[],
    amounts: ["120 €"],
    deadlines: [] as string[],
    important_points: [] as string[],
    risks: [] as string[],
    actions: [] as string[],
    risk_score: 20,
    risk_level: "faible" as const,
    risk_explanation: "",
    risk_criteria: RISK_CRITERIA.map((c) => ({
      id: c.id,
      label: c.label,
      detected: false,
      score: 0,
      max_score: c.maxScore,
      reasons: [],
    })),
    risk_findings: [],
    ...overrides,
  };
}

function makeRecord(
  userId: string,
  documentId: string,
  opts: {
    category: HistoryRecord["classification"]["category"];
    title: string;
    org: string;
    date: string;
    text: string;
    amounts?: string[];
    deadlines?: string[];
    risks?: string[];
    analyzedAt?: string;
  },
): HistoryRecord {
  return {
    id: `hist-${documentId}`,
    userId,
    documentId,
    fileName: `${documentId}.pdf`,
    displayName: opts.title,
    favorite: false,
    tagIds: [],
    createdAt: opts.analyzedAt ?? new Date().toISOString(),
    classification: {
      category: opts.category,
      label: opts.category,
      confidence: 0.9,
    },
    analysis: baseAnalysis({
      title: opts.title,
      date: opts.date,
      dates: [opts.date],
      organizations: [opts.org],
      document_type: opts.title,
      amounts: opts.amounts ?? ["120 €"],
      deadlines: opts.deadlines ?? [],
      risks: opts.risks ?? [],
      summary: opts.text.slice(0, 200),
    }),
    readyReply: EMPTY_READY_REPLY,
    model: "test",
    analyzedAt: opts.analyzedAt ?? new Date().toISOString(),
    extractedText: opts.text,
    folderId: null,
    analysisPhase: "complete",
  };
}

function hasType(
  rels: Awaited<ReturnType<typeof listRelationsForDoc>>,
  type: string,
  otherDoc: string,
): boolean {
  return rels.some(
    (r) =>
      r.type === type &&
      (r.toDocId === otherDoc || r.fromDocId === otherDoc) &&
      r.evidence.length >= 1,
  );
}

function expects(c: CorpusCase): ExpectedType[] {
  return Array.isArray(c.expect) ? c.expect : [c.expect];
}

async function main() {
  resetUserWorkspaceCache();
  const userId = `mem-p3-${Date.now()}`;
  await ensureUserWorkspace(userId);

  const TEXT_AXA_A = `
CONTRAT ASSURANCE HABITATION AXA MULTIRISQUE
Assureur : AXA Assurances
Risque : habitation logement
Garanties : incendie, dégâts des eaux, vol, responsabilité civile
Cotisation mensuelle : 28,50 EUR
Adresse du risque : 12 rue Victor Hugo
`.repeat(3);

  const TEXT_AXA_B = `
POLICE ASSURANCE HABITATION AXA CONFORT
Assureur : AXA Assurances
Couverture habitation et logement
Garanties incluses : incendie, vol, protection juridique
Cotisation mensuelle : 29,00 EUR
Même adresse de risque
`.repeat(3);

  const TEXT_NETFLIX_A = `
ABONNEMENT NETFLIX STANDARD
Prestataire : Netflix International
Montant : 13,49 EUR par mois
Périodicité mensuelle
Prélèvement automatique
`.repeat(3);

  const TEXT_NETFLIX_B = `
ABONNEMENT NETFLIX STANDARD
Prestataire : Netflix International
Montant : 13,60 EUR mensuel
Chaque mois — même offre
`.repeat(3);

  const TEXT_FACTURE_A = `
FACTURE ORANGE FIBRE
Émetteur : Orange SA
Montant TTC : 42,99 EUR
Abonnement mensuel fibre
Date : 01/05/2026
`.repeat(2);

  const TEXT_FACTURE_B = `
FACTURE ORANGE FIBRE
Émetteur : Orange SA
Montant TTC : 43,50 EUR
Abonnement mensuel fibre
Date : 01/06/2026
`.repeat(2);

  const TEXT_MAIF = `
CONTRAT ASSURANCE AUTO MAIF
Assureur : MAIF
Véhicule : Peugeot 208
Garanties : tous risques auto
Cotisation annuelle : 520 EUR
`.repeat(3);

  const TEXT_DEADLINE_A = `
CONTRAT LOYER SCI BETA
Bailleur : SCI Beta Habitat
Échéance de paiement loyer
`.repeat(2);

  const TEXT_DEADLINE_B = `
AVIS DE LOYER SCI BETA
Bailleur : SCI Beta Habitat
Rappel échéance loyer
`.repeat(2);

  const TEXT_FP_AMOUNT = `
FACTURE SFR MOBILE
Émetteur : SFR
Montant TTC : 19,99 EUR mensuel
`.repeat(2);

  const docs: Record<string, HistoryRecord> = {
    "axa-hab-a": makeRecord(userId, "axa-hab-a", {
      category: "assurance",
      title: "AXA habitation multirisque A",
      org: "AXA Assurances",
      date: "01/01/2025",
      text: TEXT_AXA_A,
      amounts: ["28,50 €"],
      risks: ["habitation", "incendie"],
    }),
    "axa-hab-b": makeRecord(userId, "axa-hab-b", {
      category: "assurance",
      title: "AXA habitation confort B",
      org: "AXA Assurances",
      date: "15/02/2025",
      text: TEXT_AXA_B,
      amounts: ["29,00 €"],
      risks: ["habitation", "incendie"],
    }),
    "netflix-a": makeRecord(userId, "netflix-a", {
      category: "contrat",
      title: "Abonnement Netflix A",
      org: "Netflix International",
      date: "01/03/2025",
      text: TEXT_NETFLIX_A,
      amounts: ["13,49 €"],
    }),
    "netflix-b": makeRecord(userId, "netflix-b", {
      category: "contrat",
      title: "Abonnement Netflix B",
      org: "Netflix International",
      date: "01/04/2025",
      text: TEXT_NETFLIX_B,
      amounts: ["13,60 €"],
    }),
    "facture-orange-a": makeRecord(userId, "facture-orange-a", {
      category: "facture",
      title: "Facture Orange mai",
      org: "Orange SA",
      date: "01/05/2026",
      text: TEXT_FACTURE_A,
      amounts: ["42,99 €"],
    }),
    "facture-orange-b": makeRecord(userId, "facture-orange-b", {
      category: "facture",
      title: "Facture Orange juin",
      org: "Orange SA",
      date: "01/06/2026",
      text: TEXT_FACTURE_B,
      amounts: ["43,50 €"],
    }),
    "deadline-a": makeRecord(userId, "deadline-a", {
      category: "bail",
      title: "Loyer SCI Beta A",
      org: "SCI Beta Habitat",
      date: "01/07/2026",
      text: TEXT_DEADLINE_A,
      amounts: ["800 €"],
      deadlines: ["Échéance loyer 10/07/2026"],
    }),
    "deadline-b": makeRecord(userId, "deadline-b", {
      category: "bail",
      title: "Avis loyer SCI Beta B",
      org: "SCI Beta Habitat",
      date: "01/07/2026",
      text: TEXT_DEADLINE_B,
      amounts: ["800 €"],
      deadlines: ["Échéance loyer 13/07/2026"],
    }),
    "maif-auto": makeRecord(userId, "maif-auto", {
      category: "assurance",
      title: "MAIF auto indépendante",
      org: "MAIF",
      date: "01/06/2024",
      text: TEXT_MAIF,
      amounts: ["520 €"],
      risks: ["auto"],
    }),
    "facture-sfr": makeRecord(userId, "facture-sfr", {
      category: "facture",
      title: "Facture SFR montant différent",
      org: "Orange SA",
      date: "01/08/2026",
      text: TEXT_FP_AMOUNT,
      amounts: ["19,99 €"],
    }),
  };

  const cases: CorpusCase[] = [
    {
      id: "axa-hab-b",
      label: "deux assurances même risque",
      expectWith: "axa-hab-a",
      expect: ["covers_same_risk", "same_guarantee"],
    },
    {
      id: "netflix-b",
      label: "deux abonnements identiques",
      expectWith: "netflix-a",
      expect: "redundant_payment",
    },
    {
      id: "facture-orange-b",
      label: "paiements en double ±2%",
      expectWith: "facture-orange-a",
      expect: "redundant_payment",
    },
    {
      id: "deadline-b",
      label: "échéances proches ±7j",
      expectWith: "deadline-a",
      expect: "linked_deadline",
    },
    {
      id: "maif-auto",
      label: "faux positif risque (orgs différentes)",
      expectWith: "axa-hab-a",
      expect: "none",
    },
    {
      id: "facture-sfr",
      label: "faux positif montant (écart >2%)",
      expectWith: "facture-orange-a",
      expect: "none",
    },
  ];

  const ingestOrder = [
    "axa-hab-a",
    "netflix-a",
    "facture-orange-a",
    "deadline-a",
  ];

  const selectorTimes: number[] = [];
  const enginePairApprox: number[] = [];

  for (const id of ingestOrder) {
    const r = await upsertMemoryFromHistoryRecord(docs[id]);
    if (r.relationMetrics) {
      selectorTimes.push(r.relationMetrics.candidateSelectorMs);
      if (r.relationMetrics.pairsCompared > 0) {
        enginePairApprox.push(
          r.relationMetrics.relationEngineMs /
            r.relationMetrics.pairsCompared,
        );
      }
    }
  }

  let tp = 0;
  let fp = 0;
  let fn = 0;
  const details: Array<Record<string, unknown>> = [];

  for (const c of cases) {
    const result = await upsertMemoryFromHistoryRecord(docs[c.id]);
    assert.ok(result.relationMetrics, "metrics P3 présentes");
    assert.ok(
      result.relationMetrics!.candidateCount <= MAX_CANDIDATES,
      `K≤20 got ${result.relationMetrics!.candidateCount}`,
    );
    selectorTimes.push(result.relationMetrics!.candidateSelectorMs);
    if (result.relationMetrics!.pairsCompared > 0) {
      enginePairApprox.push(
        result.relationMetrics!.relationEngineMs /
          result.relationMetrics!.pairsCompared,
      );
    }

    const rels = await listRelationsForDoc(userId, c.id);
    for (const r of rels) {
      assert.ok(r.evidence.length >= 1, `evidence manquante ${r.type}`);
    }

    const want = expects(c);
    const p3Types = [
      "covers_same_risk",
      "same_guarantee",
      "redundant_payment",
      "linked_deadline",
    ] as const;

    if (want.includes("none")) {
      const bad = p3Types.filter((t) => hasType(rels, t, c.expectWith));
      if (bad.length === 0) tp += 1;
      else {
        fp += 1;
        fn += 0;
      }
      details.push({
        case: c.label,
        expect: "none",
        ok: bad.length === 0,
        bad,
      });
      continue;
    }

    const hits = want.filter((t) => t !== "none" && hasType(rels, t, c.expectWith));
    const missed = want.filter(
      (t) => t !== "none" && !hasType(rels, t, c.expectWith),
    );
    tp += hits.length;
    fn += missed.length;

    // FP : type P3 fort inattendu vers la cible
    for (const t of p3Types) {
      if (!want.includes(t) && hasType(rels, t, c.expectWith)) fp += 1;
    }

    details.push({
      case: c.label,
      expect: want,
      hits,
      missed,
      ok: missed.length === 0,
    });
  }

  // Clusters échéances
  const dA = await listDeadlinesForDoc(userId, "deadline-a");
  const dB = await listDeadlinesForDoc(userId, "deadline-b");
  assert.ok(dA.length >= 1 && dB.length >= 1, "deadlines présentes");
  const clusterA = dA.find((d) => d.clusterId)?.clusterId;
  const clusterB = dB.find((d) => d.clusterId)?.clusterId;
  assert.ok(clusterA, "cluster_id assigné doc A");
  assert.ok(clusterB, "cluster_id assigné doc B");
  assert.equal(clusterA, clusterB, "même cluster pour échéances proches");

  // Alertes relationnelles
  const alerts = await listRelationAlerts(userId);
  const alertKinds = new Set(alerts.map((a) => a.kind));
  assert.ok(
    alerts.some((a) => a.kind === "relation_overlap_risk"),
    "alerte relation_overlap_risk",
  );
  assert.ok(
    alerts.some((a) => a.kind === "relation_redundant_payment"),
    "alerte relation_redundant_payment",
  );
  assert.ok(
    alerts.some((a) => a.kind === "relation_deadline_conflict"),
    "alerte relation_deadline_conflict",
  );
  for (const a of alerts) {
    assert.ok(a.evidence.length >= 1, "alerte evidence");
    assert.ok(a.relationId, "relationId sur alerte");
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  const maxSelector = Math.max(...selectorTimes, 0);
  const avgPair =
    enginePairApprox.length > 0
      ? enginePairApprox.reduce((a, b) => a + b, 0) / enginePairApprox.length
      : 0;
  const maxPair = Math.max(...enginePairApprox, 0);

  assert.ok(maxSelector < 200, `CandidateSelector raisonnable (max=${maxSelector})`);
  assert.ok(
    selectorTimes.reduce((a, b) => a + b, 0) / Math.max(selectorTimes.length, 1) < 50,
    "CandidateSelector moyenne < 50ms",
  );
  assert.ok(maxPair < 100, `RelationEngine < 100ms/paire (max=${maxPair})`);
  assert.ok(precision >= 0.8, `précision ≥ 0.8 (got ${precision})`);
  assert.ok(recall >= 0.8, `rappel ≥ 0.8 (got ${recall})`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        phase: "P3",
        precision: Number(precision.toFixed(3)),
        recall: Number(recall.toFixed(3)),
        tp,
        fp,
        fn,
        maxCandidateSelectorMs: maxSelector,
        avgRelationEngineMsPerPair: Number(avgPair.toFixed(2)),
        maxRelationEngineMsPerPair: Number(maxPair.toFixed(2)),
        alertKinds: [...alertKinds],
        alertCount: alerts.length,
        clusterId: clusterA,
        details,
      },
      null,
      2,
    ),
  );

  await rm(userDataDir(userId), { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
