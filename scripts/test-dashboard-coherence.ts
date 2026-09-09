/**
 * Cohérence dashboard après add/delete documents (mode FS isolé).
 * Vérifie les sources réelles (history, alerts, memory, stats).
 *
 * Usage: npm run test:dashboard
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
delete process.env.KV_REST_API_URL;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
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

async function main() {
  console.log("dashboard coherence\n");

  const { userDataDir } = await import("../src/config/paths");
  const {
    ensureUserWorkspace,
    resetUserWorkspaceCache,
  } = await import("../src/services/auth/workspace");
  const {
    saveHistoryRecord,
    deleteHistoryRecord,
    listHistoryRecords,
    getHistoryRecord,
  } = await import("../src/services/history/store");
  const { toHistoryListItem } = await import("../src/services/history/query");
  const { upsertMemoryFromHistoryRecord } = await import(
    "../src/services/memory"
  );
  const { getMemoryDocument } = await import(
    "../src/services/memory/document-store"
  );
  const { listCounterpartyAggregates } = await import(
    "../src/services/memory/timeline"
  );
  const { listDocumentAlerts } = await import("../src/services/alerts");
  const { buildPremiumMemoryDashboard } = await import(
    "../src/services/insights"
  );
  const {
    computeDashboardStats,
    countUpcomingDeadlineAlerts,
    filterRelationAlerts,
    listUpcomingDeadlineAlertsForDisplay,
  } = await import("../src/lib/dashboard-stats");
  const { RISK_CRITERIA } = await import("../src/services/risk/criteria");
  const { EMPTY_READY_REPLY } = await import("../src/types/reply");
  const { __resetAnalysisJobsFsForTests } = await import(
    "../src/services/analysis-jobs"
  );

  async function freshUser(label: string) {
    const userId = `dash-${label}-${randomUUID().slice(0, 8)}`;
    resetUserWorkspaceCache();
    await rm(userDataDir(userId), { recursive: true, force: true }).catch(
      () => undefined,
    );
    await ensureUserWorkspace(userId);
    await __resetAnalysisJobsFsForTests();
    return userId;
  }

  async function addDoc(
    userId: string,
    opts: {
      org: string;
      riskScore: number;
      riskLevel: "faible" | "modere" | "eleve" | "critique";
      category?: "facture" | "banque" | "bail";
      deadlines?: string[];
      actions?: string[];
    },
  ) {
    const documentId = `doc-${randomUUID().slice(0, 8)}`;
    const analyzedAt = new Date().toISOString();
    const category = opts.category ?? "facture";
    const saved = await saveHistoryRecord(userId, {
      result: {
        documentId,
        classification: {
          category,
          label: category === "banque" ? "Banque" : "Facture",
          confidence: 0.9,
        },
        analysis: {
          document_type: category === "banque" ? "Relevé" : "Facture",
          title: `Doc ${opts.org}`,
          summary: `Document ${opts.org}`,
          date: "01/02/2026",
          dates: ["01/02/2026"],
          people: [],
          organizations: [opts.org],
          amounts: ["50,00 EUR"],
          deadlines: opts.deadlines ?? [],
          important_points: [],
          risks: opts.riskLevel === "faible" ? [] : ["Risque test"],
          actions: opts.actions ?? [],
          risk_score: opts.riskScore,
          risk_level: opts.riskLevel,
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
        },
        readyReply: EMPTY_READY_REPLY,
        model: "test",
        analyzedAt,
        promptsUsed: [],
        phase: "complete",
      },
      fileName: `${opts.org.toLowerCase().replace(/\s+/g, "-")}.pdf`,
      extractedText: `Document ${opts.org}. Montant 50 EUR.`,
    });
    await upsertMemoryFromHistoryRecord({
      ...saved,
      analysisPhase: "complete",
    });
    return saved;
  }

  async function dashboardSnapshot(userId: string) {
    const records = await listHistoryRecords(userId);
    const items = records.map(toHistoryListItem);
    const alertsResult = await listDocumentAlerts(userId, {
      includeDismissed: false,
    });
    const alerts = alertsResult.alerts;
    const deadlineTotal = countUpcomingDeadlineAlerts(alerts);
    const deadlines = listUpcomingDeadlineAlertsForDisplay(alerts);
    const relations = filterRelationAlerts(alerts).slice(0, 6);
    const stats = computeDashboardStats(items, {
      upcomingDeadlinesCount: deadlineTotal,
    });
    let memory = {
      monthlySpendEur: 0,
      savingsCount: 0,
      contradictionCount: 0,
    };
    try {
      memory = await buildPremiumMemoryDashboard(userId);
    } catch {
      /* optional */
    }
    const counterparties = await listCounterpartyAggregates(userId);
    return {
      items,
      alerts,
      deadlines,
      relations,
      stats,
      memory,
      counterparties,
    };
  }

  await test("T1 dashboard 0 document", async () => {
    const userId = await freshUser("t1");
    const snap = await dashboardSnapshot(userId);
    assert.equal(snap.stats.totalAnalyses, 0);
    assert.equal(snap.stats.atRiskCount, 0);
    assert.equal(snap.stats.upcomingDeadlinesCount, 0);
    assert.equal(snap.stats.needsActionCount, 0);
    assert.equal(snap.items.length, 0);
    assert.equal(snap.counterparties.length, 0);
  });

  let userT2 = "";
  let docAId = "";
  await test("T2 dashboard 1 document", async () => {
    userT2 = await freshUser("t2");
    const doc = await addDoc(userT2, {
      org: "Banque Horizon",
      riskScore: 6,
      riskLevel: "faible",
      actions: ["Vérifier"],
    });
    docAId = doc.id;
    const snap = await dashboardSnapshot(userT2);
    assert.equal(snap.stats.totalAnalyses, 1);
    assert.equal(snap.stats.averageRiskScore, 6);
    assert.equal(snap.stats.needsActionCount, 1);
    assert.equal(snap.stats.recentDocuments.length, 1);
    assert.ok(await getMemoryDocument(userT2, doc.documentId));
  });

  let docBId = "";
  let docBDocumentId = "";
  await test("T3 dashboard plusieurs documents", async () => {
    const docB = await addDoc(userT2, {
      org: "EDF",
      riskScore: 70,
      riskLevel: "eleve",
      deadlines: ["Échéance 15/03/2026"],
      actions: ["Payer"],
    });
    docBId = docB.id;
    docBDocumentId = docB.documentId;
    const snap = await dashboardSnapshot(userT2);
    assert.equal(snap.stats.totalAnalyses, 2);
    assert.equal(snap.stats.atRiskCount, 1);
  });

  await test("T4/T17 supprimer un document sans affecter l’autre", async () => {
    await deleteHistoryRecord(userT2, docBId);
    const snap = await dashboardSnapshot(userT2);
    assert.equal(snap.stats.totalAnalyses, 1);
    assert.equal(snap.stats.atRiskCount, 0);
    assert.equal(snap.stats.averageRiskScore, 6);
    await assert.rejects(() => getHistoryRecord(userT2, docBId));
    assert.ok(await getHistoryRecord(userT2, docAId));
    assert.equal(await getMemoryDocument(userT2, docBDocumentId), null);
  });

  await test("T5/T10/T11/T15 dernier document → zéro", async () => {
    await deleteHistoryRecord(userT2, docAId);
    const snap = await dashboardSnapshot(userT2);
    assert.equal(snap.stats.totalAnalyses, 0);
    assert.equal(snap.stats.atRiskCount, 0);
    assert.equal(snap.stats.needsActionCount, 0);
    assert.equal(snap.stats.upcomingDeadlinesCount, 0);
    assert.equal(snap.stats.recentDocuments.length, 0);
    assert.ok(snap.stats.riskDistribution.every((r) => r.count === 0));
    assert.equal(snap.deadlines.length, 0);
    assert.equal(snap.relations.length, 0);
    assert.equal((await listHistoryRecords(userT2)).length, 0);
  });

  await test("T6 nouvelle analyse puis dashboard", async () => {
    const doc = await addDoc(userT2, {
      org: "Orange",
      riskScore: 20,
      riskLevel: "faible",
    });
    const snap = await dashboardSnapshot(userT2);
    assert.equal(snap.stats.totalAnalyses, 1);
    assert.ok(snap.stats.recentDocuments.some((d) => d.id === doc.id));
  });

  await test("T7 suppression puis re-lecture stats", async () => {
    const items = (await listHistoryRecords(userT2)).map(toHistoryListItem);
    assert.equal(items.length, 1);
    await deleteHistoryRecord(userT2, items[0]!.id);
    const snap = await dashboardSnapshot(userT2);
    assert.equal(snap.stats.totalAnalyses, 0);
  });

  await test("T8/T9 mémoire et contreparties après suppression", async () => {
    const userId = await freshUser("mem");
    const d1 = await addDoc(userId, {
      org: "Free Mobile",
      riskScore: 15,
      riskLevel: "faible",
    });
    const d2 = await addDoc(userId, {
      org: "Free Mobile",
      riskScore: 15,
      riskLevel: "faible",
    });
    let snap = await dashboardSnapshot(userId);
    assert.ok(snap.counterparties.some((c) => /free/i.test(c.name)));
    await deleteHistoryRecord(userId, d1.id);
    await deleteHistoryRecord(userId, d2.id);
    snap = await dashboardSnapshot(userId);
    assert.equal(snap.stats.totalAnalyses, 0);
    assert.equal(await getMemoryDocument(userId, d1.documentId), null);
    assert.equal(await getMemoryDocument(userId, d2.documentId), null);
    assert.equal(snap.counterparties.length, 0);
  });

  await test("T12 isolation deux utilisateurs", async () => {
    const a = await freshUser("isoA");
    const b = await freshUser("isoB");
    await addDoc(a, { org: "OnlyA", riskScore: 10, riskLevel: "faible" });
    await addDoc(b, { org: "OnlyB", riskScore: 90, riskLevel: "critique" });
    const snapA = await dashboardSnapshot(a);
    const snapB = await dashboardSnapshot(b);
    assert.equal(snapA.stats.totalAnalyses, 1);
    assert.equal(snapB.stats.totalAnalyses, 1);
    assert.equal(snapA.stats.atRiskCount, 0);
    assert.equal(snapB.stats.atRiskCount, 1);
    const listA = await listHistoryRecords(a);
    const listB = await listHistoryRecords(b);
    assert.equal(listA.length, 1);
    assert.equal(listB.length, 1);
    assert.notEqual(listA[0]!.id, listB[0]!.id);
    await deleteHistoryRecord(a, listA[0]!.id);
    assert.equal((await listHistoryRecords(b)).length, 1);
    assert.equal((await listHistoryRecords(a)).length, 0);
  });

  await test("T13 delete history inexistant → erreur", async () => {
    const userId = await freshUser("t13");
    await assert.rejects(() =>
      deleteHistoryRecord(userId, "missing-history-id"),
    );
  });

  await test("T14/T16 delete fiche puis reload snapshot vide", async () => {
    const userId = await freshUser("t14");
    const doc = await addDoc(userId, {
      org: "MAIF",
      riskScore: 40,
      riskLevel: "modere",
      deadlines: ["Renouvellement 01/06/2026"],
    });
    let snap = await dashboardSnapshot(userId);
    assert.equal(snap.stats.totalAnalyses, 1);
    await deleteHistoryRecord(userId, doc.id);
    snap = await dashboardSnapshot(userId);
    assert.equal(snap.stats.totalAnalyses, 0);
    assert.equal(snap.stats.upcomingDeadlinesCount, 0);
    assert.equal(await getMemoryDocument(userId, doc.documentId), null);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
