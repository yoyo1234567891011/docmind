/**
 * Corpus P4 — contradictions, faits obsolètes, avenants, factures + timeline.
 * LLM verify hors chemin critique (testé en sélection uniquement).
 * Sans LLM réseau.
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
  AMBIGUOUS_SCORE_MAX,
  AMBIGUOUS_SCORE_MIN,
  buildDocumentTimeline,
  listCounterpartyAggregates,
  listRelationsForDoc,
  MAX_CANDIDATES,
  MAX_LLM_VERIFY_PER_DOC,
  selectAmbiguousRelations,
  upsertMemoryFromHistoryRecord,
} from "../src/services/memory";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import type { HistoryRecord } from "../src/types";
import type { MemoryRelation } from "../src/types/memory";
import { EMPTY_READY_REPLY } from "../src/types/reply";

type Expected =
  | "contradicts_clause"
  | "obsoletes_fact"
  | "amends"
  | "invoice_for"
  | "none";

interface CorpusCase {
  id: string;
  label: string;
  expectWith: string;
  expect: Expected;
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
    important_points?: string[];
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
      important_points: opts.important_points ?? [],
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
      r.evidence.length >= 1 &&
      r.evidence.some((e) => e.field === "justification" || e.field === "citation" || e.field === "clause_type" || e.field === "fact_kind" || e.field === "amend_signal" || e.field === "category_pair"),
  );
}

function evidenceComplete(rel: MemoryRelation): boolean {
  if (rel.evidence.length < 2) return false;
  const fields = new Set(rel.evidence.map((e) => e.field));
  if (rel.type === "contradicts_clause") {
    return (
      fields.has("clause_type") &&
      fields.has("citation") &&
      fields.has("justification")
    );
  }
  if (rel.type === "obsoletes_fact") {
    return fields.has("fact_kind") && fields.has("justification");
  }
  if (rel.type === "amends") {
    return fields.has("amend_signal") && fields.has("justification");
  }
  if (rel.type === "invoice_for") {
    return fields.has("category_pair") && fields.has("justification");
  }
  return rel.evidence.length >= 1;
}

async function main() {
  resetUserWorkspaceCache();
  const userId = `mem-p4-${Date.now()}`;
  await ensureUserWorkspace(userId);

  const TEXT_PREAVIS_60 = `
CONTRAT ASSURANCE HABITATION MAIF
Assureur : MAIF
Adresse du risque : 10 rue de Paris 75001
Préavis de résiliation : 60 jours
Franchise : 150 EUR
Cotisation mensuelle : 25,00 EUR
Tacite reconduction annuelle
`.repeat(3);

  const TEXT_PREAVIS_30 = `
CONTRAT ASSURANCE HABITATION MAIF
Assureur : MAIF
Adresse du risque : 10 rue de Paris 75001
Préavis de résiliation : 30 jours
Franchise : 150 EUR
Cotisation mensuelle : 25,00 EUR
Tacite reconduction annuelle
`.repeat(3);

  const TEXT_ADDR_OLD = `
CONTRAT ORANGE FIBRE
Prestataire : Orange SA
Adresse d'installation : 5 avenue Victor Hugo 69000 Lyon
Abonnement mensuel : 39,99 EUR
`.repeat(3);

  const TEXT_ADDR_NEW = `
CONTRAT ORANGE FIBRE
Prestataire : Orange SA
Adresse d'installation : 22 boulevard Haussmann 75009 Paris
Abonnement mensuel : 42,99 EUR
`.repeat(3);

  const TEXT_BASE = `
CONTRAT ASSURANCE AUTO AXA
Assureur : AXA Assurances
Véhicule : Clio
Cotisation annuelle : 480 EUR
`.repeat(3);

  const TEXT_AVENANT = `
AVENANT AU CONTRAT ASSURANCE AUTO AXA
Assureur : AXA Assurances
Modification du contrat : extension conducteur secondaire
Cotisation annuelle : 520 EUR
`.repeat(3);

  const TEXT_CONTRAT_EDF = `
CONTRAT FOURNITURE ELECTRICITE EDF
Prestataire : EDF
Offre : Vert Electrique
Montant mensuel estimé : 85,00 EUR
`.repeat(2);

  const TEXT_FACTURE_EDF = `
FACTURE EDF ELECTRICITE
Émetteur : EDF
Montant TTC : 84,50 EUR
Période de facturation mensuelle
`.repeat(2);

  const TEXT_INDEPENDENT = `
CONTRAT BANQUE CREDIT AGRICOLE
Prestataire : Credit Agricole
Compte courant
`.repeat(2);

  const docs: Record<string, HistoryRecord> = {
    "maif-preavis-60": makeRecord(userId, "maif-preavis-60", {
      category: "assurance",
      title: "MAIF habitation préavis 60j",
      org: "MAIF",
      date: "01/01/2024",
      text: TEXT_PREAVIS_60,
      amounts: ["25,00 €"],
      important_points: ["Préavis de résiliation : 60 jours"],
      analyzedAt: "2024-01-01T10:00:00.000Z",
    }),
    "maif-preavis-30": makeRecord(userId, "maif-preavis-30", {
      category: "assurance",
      title: "MAIF habitation préavis 30j",
      org: "MAIF",
      date: "01/06/2024",
      text: TEXT_PREAVIS_30,
      amounts: ["25,00 €"],
      important_points: ["Préavis de résiliation : 30 jours"],
      analyzedAt: "2024-06-01T10:00:00.000Z",
    }),
    "orange-old": makeRecord(userId, "orange-old", {
      category: "contrat",
      title: "Orange fibre Lyon",
      org: "Orange SA",
      date: "01/03/2023",
      text: TEXT_ADDR_OLD,
      amounts: ["39,99 €"],
      analyzedAt: "2023-03-01T10:00:00.000Z",
    }),
    "orange-new": makeRecord(userId, "orange-new", {
      category: "contrat",
      title: "Orange fibre Paris",
      org: "Orange SA",
      date: "01/03/2025",
      text: TEXT_ADDR_NEW,
      amounts: ["42,99 €"],
      analyzedAt: "2025-03-01T10:00:00.000Z",
    }),
    "axa-base": makeRecord(userId, "axa-base", {
      category: "assurance",
      title: "AXA auto base",
      org: "AXA Assurances",
      date: "01/01/2024",
      text: TEXT_BASE,
      amounts: ["480 €"],
      analyzedAt: "2024-01-01T10:00:00.000Z",
    }),
    "axa-avenant": makeRecord(userId, "axa-avenant", {
      category: "assurance",
      title: "Avenant AXA auto conducteur",
      org: "AXA Assurances",
      date: "01/09/2024",
      text: TEXT_AVENANT,
      amounts: ["520 €"],
      analyzedAt: "2024-09-01T10:00:00.000Z",
    }),
    "edf-contrat": makeRecord(userId, "edf-contrat", {
      category: "contrat",
      title: "Contrat EDF Vert",
      org: "EDF",
      date: "01/04/2026",
      text: TEXT_CONTRAT_EDF,
      amounts: ["85,00 €"],
      analyzedAt: "2026-04-01T10:00:00.000Z",
    }),
    "edf-facture": makeRecord(userId, "edf-facture", {
      category: "facture",
      title: "Facture EDF avril",
      org: "EDF",
      date: "15/04/2026",
      text: TEXT_FACTURE_EDF,
      amounts: ["84,50 €"],
      analyzedAt: "2026-04-15T10:00:00.000Z",
    }),
    "ca-indep": makeRecord(userId, "ca-indep", {
      category: "banque",
      title: "Compte CA indépendant",
      org: "Credit Agricole",
      date: "01/01/2025",
      text: TEXT_INDEPENDENT,
      amounts: ["0 €"],
      analyzedAt: "2025-01-01T10:00:00.000Z",
    }),
  };

  const cases: CorpusCase[] = [
    {
      id: "maif-preavis-30",
      label: "clauses contradictoires (préavis)",
      expectWith: "maif-preavis-60",
      expect: "contradicts_clause",
    },
    {
      id: "orange-new",
      label: "fait obsolète (adresse/tarif)",
      expectWith: "orange-old",
      expect: "obsoletes_fact",
    },
    {
      id: "axa-avenant",
      label: "avenant",
      expectWith: "axa-base",
      expect: "amends",
    },
    {
      id: "edf-facture",
      label: "facture liée",
      expectWith: "edf-contrat",
      expect: "invoice_for",
    },
    {
      id: "ca-indep",
      label: "faux positif indépendant",
      expectWith: "maif-preavis-60",
      expect: "none",
    },
  ];

  const seed = [
    "maif-preavis-60",
    "orange-old",
    "axa-base",
    "edf-contrat",
  ];

  const selectorTimes: number[] = [];
  const enginePairApprox: number[] = [];

  for (const id of seed) {
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
  const p4Types = [
    "contradicts_clause",
    "obsoletes_fact",
    "amends",
    "invoice_for",
  ] as const;

  for (const c of cases) {
    const result = await upsertMemoryFromHistoryRecord(docs[c.id]);
    assert.ok(result.relationMetrics, "metrics présentes");
    assert.ok(
      result.relationMetrics!.candidateCount <= MAX_CANDIDATES,
      "K≤20",
    );
    selectorTimes.push(result.relationMetrics!.candidateSelectorMs);
    if (result.relationMetrics!.pairsCompared > 0) {
      enginePairApprox.push(
        result.relationMetrics!.relationEngineMs /
          result.relationMetrics!.pairsCompared,
      );
    }

    const rels = await listRelationsForDoc(userId, c.id);
    for (const r of rels.filter((x) =>
      (p4Types as readonly string[]).includes(x.type),
    )) {
      assert.ok(evidenceComplete(r), `evidence incomplete ${r.type}`);
    }

    if (c.expect === "none") {
      const bad = p4Types.filter((t) => hasType(rels, t, c.expectWith));
      if (bad.length === 0) tp += 1;
      else fp += 1;
      details.push({ case: c.label, expect: "none", ok: bad.length === 0, bad });
      continue;
    }

    const hit = hasType(rels, c.expect, c.expectWith);
    if (hit) tp += 1;
    else fn += 1;
    for (const t of p4Types) {
      if (t !== c.expect && hasType(rels, t, c.expectWith)) fp += 1;
    }
    details.push({ case: c.label, expect: c.expect, ok: hit });
  }

  // Timeline + agrégats
  const timeline = await buildDocumentTimeline(userId, "orange-new");
  assert.ok(timeline.events.length >= 2, "timeline events");
  assert.ok(
    timeline.events.some((e) => e.kind === "document"),
    "timeline documents",
  );

  const counterparties = await listCounterpartyAggregates(userId);
  assert.ok(
    counterparties.some((c) => /orange|maif|edf|axa/i.test(c.name)),
    "agrégats contreparties",
  );

  // Alertes contradiction
  const alerts = await listRelationAlerts(userId);
  assert.ok(
    alerts.some((a) => a.kind === "relation_contradiction"),
    "alerte relation_contradiction",
  );

  // LLM ambigu : sélection seule, pas d'appel réseau
  const fake: MemoryRelation[] = [
    {
      id: "1",
      userId,
      type: "amends",
      fromDocId: "a",
      toDocId: "b",
      fromNode: null,
      toNode: null,
      score: 0.78,
      method: "rules",
      evidence: [{ field: "x", left: "1", right: "2" }],
      status: "proposed",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "2",
      userId,
      type: "amends",
      fromDocId: "a",
      toDocId: "c",
      fromNode: null,
      toNode: null,
      score: 0.95,
      method: "rules",
      evidence: [{ field: "x", left: "1", right: "2" }],
      status: "proposed",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  const selected = selectAmbiguousRelations(fake);
  assert.equal(selected.length, 1);
  assert.ok(
    selected[0].score >= AMBIGUOUS_SCORE_MIN &&
      selected[0].score < AMBIGUOUS_SCORE_MAX,
  );
  assert.ok(MAX_LLM_VERIFY_PER_DOC <= 3);

  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  const maxSelector = Math.max(...selectorTimes, 0);
  const maxPair = Math.max(...enginePairApprox, 0);
  const avgPair =
    enginePairApprox.length > 0
      ? enginePairApprox.reduce((a, b) => a + b, 0) / enginePairApprox.length
      : 0;

  assert.ok(maxSelector < 50, `CandidateSelector < 50ms (max=${maxSelector})`);
  assert.ok(maxPair < 100, `RelationEngine < 100ms/paire (max=${maxPair})`);
  assert.ok(precision >= 0.75, `précision ≥ 0.75 (got ${precision})`);
  assert.ok(recall >= 0.75, `rappel ≥ 0.75 (got ${recall})`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        phase: "P4",
        precision: Number(precision.toFixed(3)),
        recall: Number(recall.toFixed(3)),
        tp,
        fp,
        fn,
        maxCandidateSelectorMs: maxSelector,
        avgRelationEngineMsPerPair: Number(avgPair.toFixed(2)),
        maxRelationEngineMsPerPair: Number(maxPair.toFixed(2)),
        timelineEvents: timeline.events.length,
        counterparties: counterparties.map((c) => ({
          name: c.name,
          docs: c.documentCount,
        })),
        contradictionAlerts: alerts.filter(
          (a) => a.kind === "relation_contradiction",
        ).length,
        llmVerifyDefaultOff: process.env.MEMORY_RELATION_LLM_VERIFY !== "1",
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
