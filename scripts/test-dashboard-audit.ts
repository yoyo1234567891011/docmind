/**
 * Audit exhaustif Dashboard — stats, échéances, exactitude, empty, NaN.
 * Usage: npm run test:dashboard-audit
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
  listHistoryRecords,
  saveHistoryRecord,
} from "@/services/history/store";
import { toHistoryListItem } from "@/services/history/query";
import { __resetAnalysisJobsFsForTests } from "@/services/analysis-jobs";
import {
  buildPremiumMemoryDashboard,
  listSubscriptionInsights,
} from "@/services/insights";
import { upsertMemoryFromHistoryRecord } from "@/services/memory/upsert-from-analysis";
import { listDocumentAlerts } from "@/services/alerts";
import { listCounterpartyAggregates } from "@/services/memory/timeline";
import { getCorpusSize } from "@/services/memory/indexes";
import { purgeMemoryForDocument } from "@/services/memory";
import { getHistoryRecord } from "@/services/history/store";
import {
  computeDashboardStats,
  countUpcomingDeadlineAlerts,
  filterRelationAlerts,
  filterUpcomingDeadlineAlerts,
  listRelationAlertsForDisplay,
  listUpcomingDeadlineAlertsForDisplay,
} from "@/lib/dashboard-stats";
import { RISK_CRITERIA } from "@/services/risk/criteria";
import type { DocumentAlert, HistoryListItem, HistoryRecord } from "@/types";
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
  const userId = `daudit-${label}-${randomUUID().slice(0, 8)}`;
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

function fakeAlert(
  partial: Partial<DocumentAlert> & Pick<DocumentAlert, "id" | "kind">,
): DocumentAlert {
  return {
    documentId: "d",
    historyId: "h",
    title: "t",
    message: "m",
    severity: "info",
    createdAt: new Date().toISOString(),
    dismissed: false,
    read: false,
    ...partial,
  };
}

function fakeItem(
  partial: Partial<HistoryListItem> & Pick<HistoryListItem, "id">,
): HistoryListItem {
  return {
    documentId: `doc-${partial.id}`,
    fileName: "a.pdf",
    displayName: "Doc",
    category: "contrat",
    categoryLabel: "Contrat",
    riskScore: 10,
    riskLevel: "faible",
    analyzedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    favorite: false,
    needsAction: false,
    actionCount: 0,
    replyRequired: false,
    tagIds: [],
    folderId: null,
    ...partial,
  };
}

async function addDoc(
  userId: string,
  opts: {
    documentId?: string;
    org: string;
    title?: string;
    riskScore?: number;
    riskLevel?: HistoryRecord["analysis"]["risk_level"];
    category?: HistoryRecord["classification"]["category"];
    amounts?: string[];
    text?: string;
    deadlines?: string[];
    actions?: string[];
    analyzedAt?: string;
  },
) {
  const documentId = opts.documentId ?? `doc-${randomUUID().slice(0, 8)}`;
  const category = opts.category ?? "contrat";
  const title = opts.title ?? `Doc ${opts.org}`;
  const text =
    opts.text ??
    `${opts.org} abonnement mensuel ${(opts.amounts?.[0] ?? "10 EUR")}. `.repeat(
      8,
    );
  const saved = await saveHistoryRecord(userId, {
    result: {
      documentId,
      classification: { category, label: category, confidence: 0.9 },
      analysis: {
        document_type: category,
        title,
        summary: text.slice(0, 120),
        date: "01/02/2026",
        dates: ["01/02/2026"],
        people: [],
        organizations: [opts.org],
        amounts: opts.amounts ?? ["10 EUR"],
        deadlines: opts.deadlines ?? [],
        important_points: [],
        risks: opts.riskLevel === "eleve" || opts.riskLevel === "critique"
          ? ["Risque"]
          : [],
        actions: opts.actions ?? [],
        risk_score: opts.riskScore ?? 10,
        risk_level: opts.riskLevel ?? "faible",
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
    extractedText: text,
  });
  await upsertMemoryFromHistoryRecord({
    ...saved,
    analysisPhase: "complete",
  });
  return saved;
}

async function main() {
  console.log("dashboard audit\n");

  await test("empty: stats cards à 0 / — (pas NaN)", () => {
    const stats = computeDashboardStats([]);
    assert.equal(stats.totalAnalyses, 0);
    assert.equal(stats.upcomingDeadlinesCount, 0);
    assert.equal(stats.averageRiskScore, 0);
    const scoreCard = stats.cards.find((c) => c.id === "score");
    assert.equal(scoreCard?.value, "—");
    for (const c of stats.cards) {
      assert.ok(c.value !== "NaN" && c.value !== "Infinity");
    }
    assert.ok(stats.riskDistribution.every((r) => r.count === 0 && r.percent === 0));
  });

  await test("calculs: moyennes / à risque / semaine", () => {
    const now = Date.now();
    const items = [
      fakeItem({
        id: "1",
        riskScore: 10,
        riskLevel: "faible",
        analyzedAt: new Date(now).toISOString(),
        needsAction: true,
      }),
      fakeItem({
        id: "2",
        riskScore: 90,
        riskLevel: "critique",
        analyzedAt: new Date(now).toISOString(),
      }),
      fakeItem({
        id: "3",
        riskScore: 50,
        riskLevel: "eleve",
        analyzedAt: new Date(now - 10 * 86400_000).toISOString(),
      }),
    ];
    const stats = computeDashboardStats(items, { upcomingDeadlinesCount: 4 });
    assert.equal(stats.totalAnalyses, 3);
    assert.equal(stats.averageRiskScore, 50); // (10+90+50)/3
    assert.equal(stats.atRiskCount, 2);
    assert.equal(stats.analysesLast7Days, 2);
    assert.equal(stats.needsActionCount, 1);
    assert.equal(stats.upcomingDeadlinesCount, 4);
    assert.equal(
      stats.cards.find((c) => c.id === "deadlines")?.value,
      "4",
    );
  });

  await test("BUGFIX: KPI échéances NON plafonné à 6", () => {
    const alerts = Array.from({ length: 10 }, (_, i) =>
      fakeAlert({
        id: `a${i}`,
        kind: "deadline_soon",
        dueDate: `2026-0${(i % 9) + 1}-15`,
      }),
    );
    assert.equal(countUpcomingDeadlineAlerts(alerts), 10);
    assert.equal(filterUpcomingDeadlineAlerts(alerts).length, 10);
    assert.equal(listUpcomingDeadlineAlertsForDisplay(alerts).length, 6);
    const stats = computeDashboardStats([], {
      upcomingDeadlinesCount: countUpcomingDeadlineAlerts(alerts),
    });
    assert.equal(stats.upcomingDeadlinesCount, 10);
    assert.equal(stats.cards.find((c) => c.id === "deadlines")?.value, "10");
  });

  await test("relations: count vs display", () => {
    const alerts = Array.from({ length: 8 }, (_, i) =>
      fakeAlert({
        id: `r${i}`,
        kind: "relation_duplicate",
      }),
    );
    assert.equal(filterRelationAlerts(alerts).length, 8);
    assert.equal(listRelationAlertsForDisplay(alerts).length, 6);
  });

  await test("riskScore non numérique → pas NaN", () => {
    const items = [
      fakeItem({ id: "1", riskScore: Number.NaN as unknown as number }),
      fakeItem({ id: "2", riskScore: 40 }),
    ];
    const stats = computeDashboardStats(items);
    assert.ok(Number.isFinite(stats.averageRiskScore));
    assert.equal(stats.cards.find((c) => c.id === "score")?.value, "20");
  });

  await test("intégration: empty → add → delete → empty", async () => {
    const userId = await fresh("crud");
    let snapItems = (await listHistoryRecords(userId)).map(toHistoryListItem);
    assert.equal(computeDashboardStats(snapItems).totalAnalyses, 0);
    assert.equal(await getCorpusSize(userId), 0);

    const a = await addDoc(userId, {
      org: "Orange",
      title: "Orange Internet",
      amounts: ["30 EUR"],
      text: "Orange Internet fibre abonnement mensuel 30 EUR. ".repeat(8),
      riskScore: 20,
    });
    const b = await addDoc(userId, {
      org: "Orange",
      title: "Orange Mobile",
      amounts: ["20 EUR"],
      text: "Orange Mobile forfait mobile abonnement mensuel 20 EUR. ".repeat(8),
      riskScore: 80,
      riskLevel: "eleve",
    });
    const c = await addDoc(userId, {
      org: "EDF",
      amounts: ["40 EUR"],
      text: "EDF électricité abonnement mensuel 40 EUR. ".repeat(8),
      riskScore: 15,
    });

    snapItems = (await listHistoryRecords(userId)).map(toHistoryListItem);
    let stats = computeDashboardStats(snapItems);
    assert.equal(stats.totalAnalyses, 3);
    assert.equal(stats.atRiskCount, 1);

    const memory = await buildPremiumMemoryDashboard(userId);
    assert.equal(memory.monthlySpendEur, 90);
    const subs = await listSubscriptionInsights(userId);
    assert.ok(subs.filter((s) => /orange/i.test(s.name)).length >= 2);

    await deleteHistoryRecord(userId, a.id);
    assert.equal(
      (await buildPremiumMemoryDashboard(userId)).monthlySpendEur,
      60,
    );

    await deleteHistoryRecord(userId, b.id);
    assert.equal(
      (await buildPremiumMemoryDashboard(userId)).monthlySpendEur,
      40,
    );

    await deleteHistoryRecord(userId, c.id);
    snapItems = (await listHistoryRecords(userId)).map(toHistoryListItem);
    stats = computeDashboardStats(snapItems);
    assert.equal(stats.totalAnalyses, 0);
    assert.equal(await getCorpusSize(userId), 0);
    const mem0 = await buildPremiumMemoryDashboard(userId);
    assert.equal(mem0.monthlySpendEur, null);
    assert.equal(mem0.subscriptionCount, 0);
    assert.equal(mem0.savingsCount, 0);
    assert.equal(mem0.contradictionCount, 0);
    await wipe(userId);
  });

  await test("réindex V1→V2→V3 : spend final seul", async () => {
    const userId = await fresh("reidx");
    const documentId = `doc-${randomUUID().slice(0, 6)}`;
    await addDoc(userId, {
      documentId,
      org: "Solo",
      amounts: ["10 EUR"],
      text: "Solo abonnement mensuel 10 EUR. ".repeat(8),
      analyzedAt: "2026-01-01T10:00:00.000Z",
    });
    for (const amount of [20, 35] as const) {
      const rec: HistoryRecord = {
        id: `hist-${randomUUID().slice(0, 8)}`,
        userId,
        documentId,
        fileName: `Solo-v${amount}.pdf`,
        displayName: `Solo ${amount}`,
        favorite: false,
        tagIds: [],
        createdAt: new Date().toISOString(),
        classification: {
          category: "contrat",
          label: "contrat",
          confidence: 0.9,
        },
        analysis: {
          document_type: "contrat",
          title: `Solo ${amount}`,
          summary: `Solo ${amount}`,
          date: "01/02/2026",
          dates: ["01/02/2026"],
          people: [],
          organizations: ["Solo"],
          amounts: [`${amount} EUR`],
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
        analyzedAt: new Date().toISOString(),
        extractedText: `Solo abonnement mensuel ${amount} EUR. `.repeat(10),
        folderId: null,
        analysisPhase: "complete",
      };
      await upsertMemoryFromHistoryRecord(rec);
    }
    assert.equal((await buildPremiumMemoryDashboard(userId)).monthlySpendEur, 35);
    assert.equal(await getCorpusSize(userId), 1);
    await wipe(userId);
  });

  await test("isolation A/B dashboard snapshot", async () => {
    const a = await fresh("iso-a");
    const b = await fresh("iso-b");
    await addDoc(a, {
      org: "OnlyA",
      amounts: ["55 EUR"],
      text: "OnlyA abonnement mensuel 55 EUR. ".repeat(8),
      riskScore: 70,
      riskLevel: "eleve",
    });
    await addDoc(b, {
      org: "OnlyB",
      amounts: ["12 EUR"],
      text: "OnlyB abonnement mensuel 12 EUR. ".repeat(8),
    });
    const statsA = computeDashboardStats(
      (await listHistoryRecords(a)).map(toHistoryListItem),
    );
    const statsB = computeDashboardStats(
      (await listHistoryRecords(b)).map(toHistoryListItem),
    );
    assert.equal(statsA.totalAnalyses, 1);
    assert.equal(statsA.atRiskCount, 1);
    assert.equal(statsB.totalAnalyses, 1);
    assert.equal(statsB.atRiskCount, 0);
    assert.equal((await buildPremiumMemoryDashboard(a)).monthlySpendEur, 55);
    assert.equal((await buildPremiumMemoryDashboard(b)).monthlySpendEur, 12);
    const cpA = await listCounterpartyAggregates(a);
    const cpB = await listCounterpartyAggregates(b);
    assert.ok(cpA.every((c) => !/onlyb/i.test(c.name)));
    assert.ok(cpB.every((c) => !/onlya/i.test(c.name)));
    await wipe(a);
    await wipe(b);
  });

  await test("reconstruction dashboard ≡ état", async () => {
    const userId = await fresh("rebuild");
    await addDoc(userId, {
      org: "Orange",
      title: "Orange Internet",
      amounts: ["30 EUR"],
      text: "Orange Internet fibre abonnement mensuel 30 EUR. ".repeat(8),
    });
    await addDoc(userId, {
      org: "Orange",
      title: "Orange Mobile",
      amounts: ["20 EUR"],
      text: "Orange Mobile forfait mobile abonnement mensuel 20 EUR. ".repeat(8),
    });
    const beforeStats = computeDashboardStats(
      (await listHistoryRecords(userId)).map(toHistoryListItem),
    );
    const beforeMem = await buildPremiumMemoryDashboard(userId);
    const records = await listHistoryRecords(userId);
    for (const r of records) {
      await purgeMemoryForDocument(userId, r.documentId);
    }
    for (const r of records) {
      const full = await getHistoryRecord(userId, r.id);
      await upsertMemoryFromHistoryRecord({
        ...full,
        analysisPhase: "complete",
      });
    }
    const afterStats = computeDashboardStats(
      (await listHistoryRecords(userId)).map(toHistoryListItem),
    );
    const afterMem = await buildPremiumMemoryDashboard(userId);
    assert.equal(afterStats.totalAnalyses, beforeStats.totalAnalyses);
    assert.equal(afterMem.monthlySpendEur, beforeMem.monthlySpendEur);
    assert.equal(afterMem.subscriptionCount, beforeMem.subscriptionCount);
    await wipe(userId);
  });

  await test("alertes: dismissed exclus du compteur", () => {
    const alerts = [
      fakeAlert({ id: "1", kind: "deadline_soon", dueDate: "2026-05-01" }),
      fakeAlert({
        id: "2",
        kind: "deadline_soon",
        dueDate: "2026-06-01",
        dismissed: true,
      }),
    ];
    assert.equal(countUpcomingDeadlineAlerts(alerts), 1);
  });

  await test("invariants: alerts listDocumentAlerts scoped", async () => {
    const userId = await fresh("alerts");
    await addDoc(userId, {
      org: "AlertCo",
      riskScore: 10,
      deadlines: ["Échéance paiement 15/08/2026"],
      text: "AlertCo abonnement mensuel 10 EUR échéance. ".repeat(6),
    });
    const { alerts } = await listDocumentAlerts(userId, {
      includeDismissed: false,
    });
    for (const a of alerts) {
      assert.ok(a.historyId);
      const hist = await getHistoryRecord(userId, a.historyId);
      assert.ok(hist);
    }
    await wipe(userId);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
