/**
 * Corpus P1 — doublons, renouvellements, contrats indépendants.
 * Mesure précision / rappel + budgets CandidateSelector / RelationEngine.
 * Sans LLM.
 */
import assert from "assert";
import { rm } from "fs/promises";

import { userDataDir } from "../src/config/paths";
import {
  ensureUserWorkspace,
  resetUserWorkspaceCache,
} from "../src/services/auth/workspace";
import {
  computeSimhash,
  hammingDistanceHex,
  listRelationsForDoc,
  upsertMemoryFromHistoryRecord,
  MAX_CANDIDATES,
} from "../src/services/memory";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import type { HistoryRecord } from "../src/types";
import { EMPTY_READY_REPLY } from "../src/types/reply";

type Expected =
  | "duplicate_of"
  | "supersedes"
  | "same_contract_family"
  | "none";

interface CorpusCase {
  id: string;
  label: string;
  expectWith: string; // other doc id
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

async function main() {
  resetUserWorkspaceCache();
  const userId = `mem-p1-${Date.now()}`;
  await ensureUserWorkspace(userId);

  // --- SimHash unit ---
  const h1 = computeSimhash("contrat assurance orange fibre 2024 abonnement");
  const h2 = computeSimhash("contrat assurance orange fibre 2024 abonnement");
  assert.equal(h1, h2);
  assert.equal(hammingDistanceHex(h1, h2), 0);
  const h3 = computeSimhash(
    "contrat assurance orange fibre 2024 abonnement mensuel modifie legerement",
  );
  assert.ok(hammingDistanceHex(h1, h3) <= 10, "near-dup simhash");

  const TEXT_ORANGE_2024 = `
CONTRAT ASSURANCE HABITATION ORANGE HOME
Assureur : Orange Assurances SA
Assuré : Client Demo
Adresse du risque : 10 rue de Paris
Cotisation mensuelle : 12,50 EUR
Date d'effet : 01/03/2024
Garanties : incendie, dégâts des eaux, vol
Franchise : 150 EUR
Tacite reconduction annuelle
Préavis de résiliation : 2 mois
`.repeat(3);

  const TEXT_ORANGE_2025 = `
CONTRAT ASSURANCE HABITATION ORANGE HOME
Assureur : Orange Assurances SA
Assuré : Client Demo
Adresse du risque : 10 rue de Paris
Cotisation mensuelle : 13,90 EUR
Date d'effet : 01/03/2025
Garanties : incendie, dégâts des eaux, vol, bris de glace
Franchise : 150 EUR
Tacite reconduction annuelle
Préavis de résiliation : 2 mois
Conditions mises à jour 2025
`.repeat(3);

  const TEXT_ORANGE_DUP = TEXT_ORANGE_2024; // exact duplicate

  const TEXT_MAIF = `
CONTRAT ASSURANCE AUTO MAIF
Assureur : MAIF
Véhicule : Renault Clio
Cotisation annuelle : 420 EUR
Date d'effet : 15/06/2024
Garanties : tous risques
Franchise : 300 EUR
`.repeat(3);

  const TEXT_BAIL = `
BAIL D'HABITATION
Bailleur : SCI Alpha Habitat
Locataire : Jean Dupont
Loyer : 800 EUR
Dépôt de garantie : 1600 EUR
Date de début : 01/09/2024
Préavis : 1 mois
`.repeat(2);

  // Fill corpus with distractors (indépendants) to stress K << N
  const distractors: HistoryRecord[] = [];
  for (let i = 0; i < 15; i++) {
    distractors.push(
      makeRecord(userId, `dist-${i}`, {
        category: i % 2 === 0 ? "facture" : "impots",
        title: `Document divers ${i}`,
        org: `Org Divers ${i}`,
        date: `01/0${(i % 9) + 1}/2023`,
        text: `Facture ou impot divers numero ${i} montant ${100 + i} euros reference REF${i} `.repeat(
          20,
        ),
      }),
    );
  }

  const docs: Record<string, HistoryRecord> = {
    "orange-2024": makeRecord(userId, "orange-2024", {
      category: "assurance",
      title: "Assurance habitation Orange Home 2024",
      org: "Orange Assurances SA",
      date: "01/03/2024",
      text: TEXT_ORANGE_2024,
      analyzedAt: "2024-03-01T10:00:00.000Z",
    }),
    "orange-2025": makeRecord(userId, "orange-2025", {
      category: "assurance",
      title: "Assurance habitation Orange Home 2025",
      org: "Orange Assurances SA",
      date: "01/03/2025",
      text: TEXT_ORANGE_2025,
      analyzedAt: "2025-03-01T10:00:00.000Z",
    }),
    "orange-dup": makeRecord(userId, "orange-dup", {
      category: "assurance",
      title: "Assurance habitation Orange Home 2024 (copie)",
      org: "Orange Assurances SA",
      date: "01/03/2024",
      text: TEXT_ORANGE_DUP,
      analyzedAt: "2024-03-02T10:00:00.000Z",
    }),
    "maif-auto": makeRecord(userId, "maif-auto", {
      category: "assurance",
      title: "Assurance auto MAIF",
      org: "MAIF",
      date: "15/06/2024",
      text: TEXT_MAIF,
    }),
    "bail-alpha": makeRecord(userId, "bail-alpha", {
      category: "bail",
      title: "Bail SCI Alpha",
      org: "SCI Alpha Habitat",
      date: "01/09/2024",
      text: TEXT_BAIL,
    }),
  };

  const cases: CorpusCase[] = [
    {
      id: "orange-dup",
      label: "doublon exact",
      expectWith: "orange-2024",
      expect: "duplicate_of",
    },
    {
      id: "orange-2025",
      label: "renouvellement",
      expectWith: "orange-2024",
      expect: "supersedes",
    },
    {
      id: "maif-auto",
      label: "indépendant même catégorie",
      expectWith: "orange-2024",
      expect: "none",
    },
    {
      id: "bail-alpha",
      label: "indépendant cross-catégorie",
      expectWith: "orange-2024",
      expect: "none",
    },
  ];

  // Ingest order: distractors → orange-2024 → others
  const selectorTimes: number[] = [];
  const enginePairApprox: number[] = [];
  const candidateCounts: number[] = [];

  for (const d of distractors) {
    const r = await upsertMemoryFromHistoryRecord(d);
    if (r.relationMetrics) {
      selectorTimes.push(r.relationMetrics.candidateSelectorMs);
      candidateCounts.push(r.relationMetrics.candidateCount);
      if (r.relationMetrics.pairsCompared > 0) {
        enginePairApprox.push(
          r.relationMetrics.relationEngineMs /
            r.relationMetrics.pairsCompared,
        );
      }
    }
  }

  await upsertMemoryFromHistoryRecord(docs["orange-2024"]);

  let tp = 0;
  let fp = 0;
  let fn = 0;
  const details: Array<Record<string, unknown>> = [];

  for (const c of cases) {
    const rec = docs[c.id];
    const result = await upsertMemoryFromHistoryRecord(rec);
    assert.ok(result.relationMetrics, "metrics P1 présentes");
    assert.ok(
      result.relationMetrics!.candidateCount <= MAX_CANDIDATES,
      `K≤20 got ${result.relationMetrics!.candidateCount}`,
    );
    selectorTimes.push(result.relationMetrics!.candidateSelectorMs);
    candidateCounts.push(result.relationMetrics!.candidateCount);
    if (result.relationMetrics!.pairsCompared > 0) {
      enginePairApprox.push(
        result.relationMetrics!.relationEngineMs /
          result.relationMetrics!.pairsCompared,
      );
    }

    const rels = await listRelationsForDoc(userId, c.id);
    // Toute relation proposée a une evidence
    for (const r of rels) {
      assert.ok(r.evidence.length >= 1, `evidence manquante ${r.type}`);
    }

    const gotDup = hasType(rels, "duplicate_of", c.expectWith);
    const gotSup = hasType(rels, "supersedes", c.expectWith);
    const gotFam = hasType(rels, "same_contract_family", c.expectWith);

    let ok = false;
    if (c.expect === "duplicate_of") ok = gotDup;
    else if (c.expect === "supersedes") ok = gotSup || gotFam; // family acceptable partial
    else if (c.expect === "same_contract_family") ok = gotFam || gotSup;
    else ok = !gotDup && !gotSup; // none: pas de lien fort avec la cible

    // Precision counting for strong types
    if (c.expect === "duplicate_of") {
      if (gotDup) tp += 1;
      else fn += 1;
      if (gotSup) fp += 1;
    } else if (c.expect === "supersedes") {
      if (gotSup) tp += 1;
      else if (gotFam) tp += 0.5; // partial credit family
      else fn += 1;
      if (gotDup) fp += 1;
    } else {
      if (gotDup || gotSup) fp += 1;
      else tp += 1;
    }

    details.push({
      case: c.label,
      expect: c.expect,
      ok,
      gotDup,
      gotSup,
      gotFam,
      candidates: result.relationMetrics!.candidateCount,
      selectorMs: result.relationMetrics!.candidateSelectorMs,
      engineMs: result.relationMetrics!.relationEngineMs,
      pairs: result.relationMetrics!.pairsCompared,
    });
  }

  const precision = tp / Math.max(tp + fp, 1);
  const recall = tp / Math.max(tp + fn, 1);
  const avgCandidates =
    candidateCounts.reduce((a, b) => a + b, 0) / candidateCounts.length;
  const avgSelector =
    selectorTimes.reduce((a, b) => a + b, 0) / selectorTimes.length;
  const avgPairEngine =
    enginePairApprox.length === 0
      ? 0
      : enginePairApprox.reduce((a, b) => a + b, 0) / enginePairApprox.length;
  const maxSelector = Math.max(...selectorTimes);

  // Budgets (marge CI locale)
  assert.ok(maxSelector < 200, `CandidateSelector max ${maxSelector}ms (cible 50ms prod)`);
  assert.ok(avgPairEngine < 150 || enginePairApprox.length === 0, `pair engine ${avgPairEngine}`);
  assert.ok(avgCandidates <= MAX_CANDIDATES);

  // Doublon exact doit être détecté
  assert.ok(
    details.find((d) => d.case === "doublon exact")?.ok,
    "doublon exact doit matcher",
  );

  await rm(userDataDir(userId), { recursive: true, force: true });

  const report = {
    precision: Number(precision.toFixed(3)),
    recall: Number(recall.toFixed(3)),
    avgCandidates: Number(avgCandidates.toFixed(2)),
    avgCandidateSelectorMs: Number(avgSelector.toFixed(2)),
    maxCandidateSelectorMs: maxSelector,
    avgRelationEngineMsPerPair: Number(avgPairEngine.toFixed(2)),
    maxCandidatesCap: MAX_CANDIDATES,
    details,
  };

  console.log("OK test-memory-p1");
  console.log(JSON.stringify(report, null, 2));

  // Seuils qualité minimum corpus
  assert.ok(precision >= 0.6, `précision trop basse: ${precision}`);
  assert.ok(recall >= 0.5, `rappel trop bas: ${recall}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
