/**
 * KPI Mémoire documentaire — corpus, dépenses/mois, réindex relations.
 * Usage: npm run test:memory-dashboard-kpis
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";

process.env.DOCMIND_STORAGE = "fs";
process.env.DOCMIND_FS_FALLBACK = "0";
process.env.DOCMIND_FS_DUAL_WRITE = "0";
process.env.DOCMIND_SKIP_MEMORY_DUAL_WRITE = "1";
delete process.env.REDIS_URL;
delete process.env.KV_URL;
delete process.env.DATABASE_URL;

import { userDataDir } from "@/config/paths";
import {
  ensureUserWorkspace,
  resetUserWorkspaceCache,
} from "@/services/auth/workspace";
import {
  deleteHistoryRecord,
  saveHistoryRecord,
} from "@/services/history/store";
import { __resetAnalysisJobsFsForTests } from "@/services/analysis-jobs";
import {
  buildPremiumMemoryDashboard,
  listSavingsOpportunities,
  toMonthlySpendEur,
} from "@/services/insights";
import { getCorpusSize } from "@/services/memory/indexes";
import { upsertMemoryFromHistoryRecord } from "@/services/memory/upsert-from-analysis";
import {
  listAllRelations,
  listRelationsForDoc,
  upsertRelation,
} from "@/services/memory/relation-store";
import { RISK_CRITERIA } from "@/services/risk/criteria";
import type { HistoryRecord } from "@/types";
import type { MemoryRelation } from "@/types/memory";
import { EMPTY_READY_REPLY } from "@/types/reply";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(
      `  FAIL ${name}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

async function wipe(userId: string) {
  for (let i = 0; i < 6; i++) {
    try {
      await rm(userDataDir(userId), { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 120));
    }
  }
}

async function fresh(label: string) {
  const userId = `kpi-${label}-${randomUUID().slice(0, 8)}`;
  resetUserWorkspaceCache();
  await wipe(userId);
  await ensureUserWorkspace(userId);
  await __resetAnalysisJobsFsForTests();
  return userId;
}

function criteria() {
  return RISK_CRITERIA.map((c) => ({
    id: c.id,
    label: c.label,
    detected: false,
    score: 0,
    max_score: c.maxScore,
    reasons: [] as string[],
  }));
}

async function addDoc(
  userId: string,
  opts: {
    documentId?: string;
    org: string;
    category?: HistoryRecord["classification"]["category"];
    amounts: string[];
    text: string;
    important?: string[];
    analyzedAt?: string;
  },
) {
  const documentId = opts.documentId ?? `doc-${randomUUID().slice(0, 8)}`;
  const category = opts.category ?? "contrat";
  const saved = await saveHistoryRecord(userId, {
    result: {
      documentId,
      classification: { category, label: category, confidence: 0.9 },
      analysis: {
        document_type: category,
        title: `Doc ${opts.org}`,
        summary: opts.org,
        date: "01/02/2026",
        dates: ["01/02/2026"],
        people: [],
        organizations: [opts.org],
        amounts: opts.amounts,
        deadlines: [],
        important_points: opts.important ?? [],
        risks: [],
        actions: [],
        risk_score: 10,
        risk_level: "faible",
        risk_explanation: "",
        risk_criteria: criteria(),
        risk_findings: [],
      },
      readyReply: EMPTY_READY_REPLY,
      model: "test",
      analyzedAt: opts.analyzedAt ?? new Date().toISOString(),
      promptsUsed: [],
      phase: "complete",
    },
    fileName: `${opts.org}.pdf`,
    extractedText: opts.text,
  });
  await upsertMemoryFromHistoryRecord({
    ...saved,
    analysisPhase: "complete",
  });
  return saved;
}

function makeProposed(
  userId: string,
  fromDocId: string,
  toDocId: string,
  type: MemoryRelation["type"] = "duplicate_of",
): MemoryRelation {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    userId,
    type,
    fromDocId,
    toDocId,
    fromNode: null,
    toNode: null,
    score: 0.9,
    method: "rules",
    evidence: [
      { field: "test", left: "a", right: "b", note: "fixture" },
    ],
    status: "proposed",
    createdAt: now,
    updatedAt: now,
  };
}

async function main() {
  console.log("memory dashboard KPIs\n");

  await test("toMonthlySpendEur conversions", () => {
    assert.equal(toMonthlySpendEur(50, "mensuel"), 50);
    assert.equal(toMonthlySpendEur(1200, "annuel"), 100);
    assert.equal(toMonthlySpendEur(90, "trimestriel"), 30);
    assert.equal(toMonthlySpendEur(10, "hebdomadaire"), 43.3);
    assert.equal(toMonthlySpendEur(1200, null), null);
    assert.equal(toMonthlySpendEur(1200, "inconnu"), null);
    assert.equal(toMonthlySpendEur(null, "mensuel"), null);
  });

  await test("corpus vide → 0", async () => {
    const userId = await fresh("corpus0");
    assert.equal(await getCorpusSize(userId), 0);
    const dash = await buildPremiumMemoryDashboard(userId);
    assert.ok(
      dash.uniqueValuePoints.some((p) =>
        /sur 0 document\(s\) indexés/.test(p),
      ),
      dash.uniqueValuePoints.join(" | "),
    );
    await wipe(userId);
  });

  await test("CAS1 50€/mois → 50", async () => {
    const userId = await fresh("c1");
    await addDoc(userId, {
      org: "StreamA",
      amounts: ["50,00 EUR"],
      text: "Abonnement StreamA mensuel 50 EUR par mois. ".repeat(8),
    });
    const dash = await buildPremiumMemoryDashboard(userId);
    assert.equal(dash.monthlySpendEur, 50);
    await wipe(userId);
  });

  await test("CAS2 1200€/an → 100/mois", async () => {
    const userId = await fresh("c2");
    await addDoc(userId, {
      org: "AssuranceB",
      amounts: ["1200,00 EUR"],
      text: "Contrat AssuranceB cotisation annuelle 1200 EUR par an. ".repeat(8),
    });
    const dash = await buildPremiumMemoryDashboard(userId);
    assert.equal(dash.monthlySpendEur, 100);
    await wipe(userId);
  });

  await test("CAS3 facture ponctuelle 1200 ≠ dépenses/mois", async () => {
    const userId = await fresh("c3");
    await addDoc(userId, {
      org: "OneShot",
      category: "facture",
      amounts: ["1200,00 EUR"],
      text: "Facture unique OneShot 1200 EUR. Paiement ponctuel. ".repeat(8),
    });
    const dash = await buildPremiumMemoryDashboard(userId);
    assert.notEqual(dash.monthlySpendEur, 1200);
    assert.equal(dash.monthlySpendEur, null);
    await wipe(userId);
  });

  await test("CAS4 montant sans fréquence → 0", async () => {
    const userId = await fresh("c4");
    await addDoc(userId, {
      org: "AmbiguCorp",
      amounts: ["1200,00 EUR"],
      text: "Document AmbiguCorp montant 1200 EUR sans periodicite. ".repeat(8),
    });
    const dash = await buildPremiumMemoryDashboard(userId);
    assert.equal(dash.monthlySpendEur, null);
    await wipe(userId);
  });

  await test("CAS5 deux abos 50+20 → 70", async () => {
    const userId = await fresh("c5");
    await addDoc(userId, {
      org: "NetA",
      amounts: ["50 EUR"],
      text: "Abonnement NetA mensuel 50 EUR. ".repeat(8),
    });
    await addDoc(userId, {
      org: "NetB",
      amounts: ["20 EUR"],
      text: "Abonnement NetB mensuel 20 EUR. ".repeat(8),
    });
    const dash = await buildPremiumMemoryDashboard(userId);
    assert.equal(dash.monthlySpendEur, 70);
    await wipe(userId);
  });

  await test("CAS6 facture + abo → seul l’abo compte", async () => {
    const userId = await fresh("c6");
    await addDoc(userId, {
      org: "FactureX",
      category: "facture",
      amounts: ["1200 EUR"],
      text: "Facture FactureX 1200 EUR. ".repeat(8),
    });
    await addDoc(userId, {
      org: "SubY",
      amounts: ["50 EUR"],
      text: "Abonnement SubY mensuel 50 EUR. ".repeat(8),
    });
    const dash = await buildPremiumMemoryDashboard(userId);
    assert.equal(dash.monthlySpendEur, 50);
    await wipe(userId);
  });

  await test("suppression dernier document → corpus 0 + spend 0", async () => {
    const userId = await fresh("del");
    const a = await addDoc(userId, {
      org: "Solo",
      amounts: ["15 EUR"],
      text: "Abonnement Solo mensuel 15 EUR. ".repeat(8),
    });
    assert.equal(await getCorpusSize(userId), 1);
    await deleteHistoryRecord(userId, a.id);
    assert.equal(await getCorpusSize(userId), 0);
    const dash = await buildPremiumMemoryDashboard(userId);
    assert.equal(dash.monthlySpendEur, null);
    assert.ok(
      dash.uniqueValuePoints.some((p) =>
        /sur 0 document\(s\) indexés/.test(p),
      ),
    );
    await wipe(userId);
  });

  await test("économies marquées potential + evidence", async () => {
    const userId = await fresh("save");
    await addDoc(userId, {
      org: "DupA",
      amounts: ["13,49 EUR"],
      text: "CONTRAT NETFLIX STANDARD Prestataire DupA Abonnement mensuel 13,49 EUR. ".repeat(
        6,
      ),
      analyzedAt: "2025-01-01T10:00:00.000Z",
    });
    await addDoc(userId, {
      org: "DupA",
      amounts: ["13,60 EUR"],
      text: "ABONNEMENT NETFLIX STANDARD Prestataire DupA Montant 13,60 EUR mensuel. ".repeat(
        6,
      ),
      analyzedAt: "2025-02-01T10:00:00.000Z",
    });
    const savings = await listSavingsOpportunities(userId);
    for (const s of savings) {
      assert.equal(s.certainty, "potential");
      assert.ok(/potentielle|vérifier/i.test(`${s.title} ${s.message}`));
    }
    await wipe(userId);
  });

  await test("réindex : relation A obsolète purgée, C↔D conservée", async () => {
    const userId = await fresh("reidx");
    const docA = `doc-a-${randomUUID().slice(0, 6)}`;
    const docB = `doc-b-${randomUUID().slice(0, 6)}`;
    const docC = `doc-c-${randomUUID().slice(0, 6)}`;
    const docD = `doc-d-${randomUUID().slice(0, 6)}`;

    await addDoc(userId, {
      documentId: docA,
      org: "Alpha",
      amounts: ["20 EUR"],
      text: "Contrat Alpha abonnement mensuel 20 EUR préavis 30 jours. ".repeat(
        10,
      ),
      important: ["Préavis de résiliation : 30 jours"],
      analyzedAt: "2026-01-01T10:00:00.000Z",
    });
    await addDoc(userId, {
      documentId: docB,
      org: "BetaIsolated",
      amounts: ["25 EUR"],
      text: "Contrat BetaIsolated abonnement mensuel 25 EUR préavis 90 jours. ".repeat(
        10,
      ),
      important: ["Préavis de résiliation : 90 jours"],
      analyzedAt: "2026-02-01T10:00:00.000Z",
    });
    await addDoc(userId, {
      documentId: docC,
      org: "Gamma",
      amounts: ["10 EUR"],
      text: "Contrat Gamma abonnement mensuel 10 EUR. ".repeat(8),
    });
    await addDoc(userId, {
      documentId: docD,
      org: "Delta",
      amounts: ["11 EUR"],
      text: "Contrat Delta abonnement mensuel 11 EUR. ".repeat(8),
    });

    const stale = makeProposed(userId, docA, docB, "duplicate_of");
    await upsertRelation(userId, docA, stale);
    await upsertRelation(userId, docB, {
      ...stale,
      id: randomUUID(),
      fromDocId: docB,
      toDocId: docA,
    });

    const cd = makeProposed(userId, docC, docD, "duplicate_of");
    await upsertRelation(userId, docC, cd);
    await upsertRelation(userId, docD, {
      ...cd,
      id: randomUUID(),
      fromDocId: docD,
      toDocId: docC,
    });

    const hasPair = (
      rels: MemoryRelation[],
      x: string,
      y: string,
      type: MemoryRelation["type"],
    ) =>
      rels.some(
        (r) =>
          r.type === type &&
          ((r.fromDocId === x && r.toDocId === y) ||
            (r.fromDocId === y && r.toDocId === x)),
      );

    assert.ok(
      hasPair(await listRelationsForDoc(userId, docA), docA, docB, "duplicate_of"),
    );
    assert.ok(
      hasPair(await listRelationsForDoc(userId, docC), docC, docD, "duplicate_of"),
    );

    // Réindex synchrone sans saveHistoryRecord (évite dual-write async concurrent).
    const reindexRecord: HistoryRecord = {
      id: `hist-reidx-${randomUUID().slice(0, 8)}`,
      userId,
      documentId: docA,
      fileName: "Alpha-v2.pdf",
      displayName: "Alpha v2",
      favorite: false,
      tagIds: [],
      createdAt: "2026-03-01T10:00:00.000Z",
      classification: {
        category: "contrat",
        label: "contrat",
        confidence: 0.9,
      },
      analysis: {
        document_type: "contrat",
        title: "Alpha v2",
        summary: "Reindex",
        date: "01/03/2026",
        dates: ["01/03/2026"],
        people: [],
        organizations: ["Alpha Nouveau"],
        amounts: ["99,00 EUR"],
        deadlines: [],
        important_points: [],
        risks: [],
        actions: [],
        risk_score: 10,
        risk_level: "faible",
        risk_explanation: "",
        risk_criteria: criteria(),
        risk_findings: [],
      },
      readyReply: EMPTY_READY_REPLY,
      model: "test",
      analyzedAt: "2026-03-01T10:00:00.000Z",
      extractedText:
        "Contrat Alpha Nouveau abonnement mensuel 99 EUR sans autre lien. ".repeat(
          10,
        ),
      folderId: null,
      analysisPhase: "complete",
    };
    await upsertMemoryFromHistoryRecord(reindexRecord);

    assert.equal(
      hasPair(await listRelationsForDoc(userId, docA), docA, docB, "duplicate_of"),
      false,
      "ancienne relation A↔B proposed doit partir",
    );
    assert.equal(
      hasPair(await listRelationsForDoc(userId, docB), docA, docB, "duplicate_of"),
      false,
      "miroir B↔A proposed doit partir",
    );

    const allAfter = await listAllRelations(userId);
    assert.ok(
      hasPair(allAfter, docC, docD, "duplicate_of"),
      `C↔D doit être conservée; rels=${allAfter
        .map((r) => `${r.fromDocId}->${r.toDocId}:${r.type}`)
        .join(";")}`,
    );

    const dash = await buildPremiumMemoryDashboard(userId);
    assert.ok(dash.monthlySpendEur >= 99, `spend=${dash.monthlySpendEur}`);

    // Ancienne org Alpha ne doit plus référencer docA (dérivé remplacé).
    const { listEntities } = await import("@/services/memory/entity-store");
    const { loadRelationSignals } = await import(
      "@/services/memory/relation-signals"
    );
    const { listClausesForDoc } = await import(
      "@/services/memory/clause-store"
    );
    const entities = await listEntities(userId);
    const alphaOld = entities.find((e) =>
      /alpha$/i.test(e.canonicalName) && !/nouveau/i.test(e.canonicalName),
    );
    if (alphaOld) {
      assert.equal(
        alphaOld.docIds.includes(docA),
        false,
        "ancienne entity Alpha ne doit plus lier docA",
      );
    }
    const alphaNew = entities.find((e) => /nouveau/i.test(e.canonicalName));
    assert.ok(alphaNew?.docIds.includes(docA), "Alpha Nouveau doit lier docA");

    const signals = await loadRelationSignals(userId, docA);
    assert.ok(signals?.amounts.includes(99), `signals=${JSON.stringify(signals?.amounts)}`);
    assert.equal(signals?.period, "mensuel");

    // Ancien préavis 30j ne doit plus être une clause dérivée de A.
    const clauses = await listClausesForDoc(userId, docA);
    assert.equal(
      clauses.some((c) => /30\s*jours/i.test(c.textSpan)),
      false,
      "ancienne clause préavis 30j doit avoir disparu",
    );

    await wipe(userId);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
