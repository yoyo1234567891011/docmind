/**
 * Robustesse Mémoire documentaire — identité abonnements, montants,
 * suppression, réindex, invariants, reconstruction.
 *
 * Usage: npm run test:memory-robustness
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
  getHistoryRecord,
  listHistoryRecords,
  saveHistoryRecord,
} from "@/services/history/store";
import { __resetAnalysisJobsFsForTests } from "@/services/analysis-jobs";
import {
  buildPremiumMemoryDashboard,
  listSubscriptionInsights,
  toMonthlySpendEur,
} from "@/services/insights";
import {
  amountsClose,
  pickRecurringAmountEur,
  resolveProductSignal,
} from "@/services/insights/subscription-identity";
import { getCorpusSize } from "@/services/memory/indexes";
import { getMemoryDocument } from "@/services/memory/document-store";
import { listAllRelations } from "@/services/memory/relation-store";
import { loadRelationSignals } from "@/services/memory/relation-signals";
import {
  purgeMemoryForDocument,
  upsertMemoryFromHistoryRecord,
} from "@/services/memory";
import { RISK_CRITERIA } from "@/services/risk/criteria";
import type { HistoryRecord } from "@/types";
import type { MemoryDocumentNode } from "@/types/memory";
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
  const userId = `rob-${label}-${randomUUID().slice(0, 8)}`;
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
    title?: string;
    category?: HistoryRecord["classification"]["category"];
    amounts: string[];
    text: string;
    important?: string[];
    analyzedAt?: string;
    deadlines?: string[];
  },
) {
  const documentId = opts.documentId ?? `doc-${randomUUID().slice(0, 8)}`;
  const category = opts.category ?? "contrat";
  const title = opts.title ?? `Doc ${opts.org}`;
  const saved = await saveHistoryRecord(userId, {
    result: {
      documentId,
      classification: { category, label: category, confidence: 0.9 },
      analysis: {
        document_type: category,
        title,
        summary: opts.text.slice(0, 160),
        date: "01/02/2026",
        dates: ["01/02/2026"],
        people: [],
        organizations: [opts.org],
        amounts: opts.amounts,
        deadlines: opts.deadlines ?? [],
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
    fileName: `${opts.org}-${title}.pdf`.replace(/\s+/g, "-"),
    extractedText: opts.text,
  });
  await upsertMemoryFromHistoryRecord({
    ...saved,
    analysisPhase: "complete",
  });
  return saved;
}

async function main() {
  console.log("memory robustness\n");

  await test("unit: toMonthlySpendEur", () => {
    assert.equal(toMonthlySpendEur(50, "mensuel"), 50);
    assert.equal(toMonthlySpendEur(1200, "annuel"), 100);
    assert.equal(toMonthlySpendEur(300, "trimestriel"), 100);
    assert.equal(toMonthlySpendEur(100, "hebdomadaire"), 433);
    assert.equal(toMonthlySpendEur(1200, null), null);
    assert.equal(toMonthlySpendEur(1200, "inconnu"), null);
  });

  await test("unit: pickRecurringAmountEur", () => {
    assert.equal(pickRecurringAmountEur([30], "mensuel", ""), 30);
    assert.equal(
      pickRecurringAmountEur(
        [30, 50, 360],
        "mensuel",
        "Prix mensuel : 30 € Frais d'activation : 50 € Total annuel : 360 €",
      ),
      30,
    );
    assert.equal(
      pickRecurringAmountEur([30, 50], "mensuel", "Montants divers sans ancre"),
      null,
    );
  });

  await test("unit: resolveProductSignal internet/mobile", () => {
    const base = {
      id: "n",
      userId: "u",
      documentId: "d1",
      historyId: "h",
      fileName: "x.pdf",
      category: "contrat",
      status: "active" as const,
      analyzedAt: "2026-01-01T00:00:00.000Z",
      relationsPhase: "ready" as const,
      primaryEntityIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const internet = resolveProductSignal(
      base,
      {
        documentId: "d1",
        category: "contrat",
        title: "Orange Internet",
        productHints: "Orange Internet fibre 30 EUR mensuel",
        guaranteeLabels: [],
        riskLabels: [],
        amounts: [30],
        period: "mensuel",
        updatedAt: base.updatedAt,
      },
      "Orange",
    );
    assert.equal(internet.key, "internet");
    const mobile = resolveProductSignal(
      { ...base, documentId: "d2" },
      {
        documentId: "d2",
        category: "contrat",
        title: "Orange Mobile",
        productHints: "Orange Mobile forfait 20 EUR mensuel",
        guaranteeLabels: [],
        riskLabels: [],
        amounts: [20],
        period: "mensuel",
        updatedAt: base.updatedAt,
      },
      "Orange",
    );
    assert.equal(mobile.key, "mobile");
    assert.ok(amountsClose(13.49, 13.6));
    assert.ok(!amountsClose(30, 35));
  });

  await test("Orange Internet 30 + Mobile 20 → 50, 2 lignes", async () => {
    const userId = await fresh("orange2");
    await addDoc(userId, {
      org: "Orange",
      title: "Orange Internet",
      amounts: ["30 EUR"],
      text: "Contrat Orange Internet fibre abonnement mensuel 30 EUR par mois. ".repeat(
        8,
      ),
      analyzedAt: "2026-01-01T10:00:00.000Z",
    });
    await addDoc(userId, {
      org: "Orange",
      title: "Orange Mobile",
      amounts: ["20 EUR"],
      text: "Contrat Orange Mobile forfait mobile abonnement mensuel 20 EUR par mois. ".repeat(
        8,
      ),
      analyzedAt: "2026-02-01T10:00:00.000Z",
    });
    const subs = await listSubscriptionInsights(userId);
    const orange = subs.filter((s) => /orange/i.test(s.name));
    assert.ok(orange.length >= 2, `attendu ≥2 lignes Orange, got ${orange.length}: ${orange.map((s) => s.name).join(", ")}`);
    const dash = await buildPremiumMemoryDashboard(userId);
    assert.equal(dash.monthlySpendEur, 50);
    const keys = new Set(orange.map((s) => s.productKey));
    assert.ok(keys.has("internet"));
    assert.ok(keys.has("mobile"));
    await wipe(userId);
  });

  await test("même info 2 PDF → un abo (pas 60€)", async () => {
    const userId = await fresh("dup");
    await addDoc(userId, {
      org: "StreamZ",
      amounts: ["30 EUR"],
      text: "Abonnement StreamZ mensuel 30 EUR. ".repeat(10),
      analyzedAt: "2026-01-01T10:00:00.000Z",
    });
    await addDoc(userId, {
      org: "StreamZ",
      amounts: ["30 EUR"],
      text: "Abonnement StreamZ mensuel 30 EUR. ".repeat(10),
      analyzedAt: "2026-02-01T10:00:00.000Z",
    });
    const dash = await buildPremiumMemoryDashboard(userId);
    assert.equal(dash.monthlySpendEur, 30);
    const subs = await listSubscriptionInsights(userId);
    const stream = subs.filter((s) => /streamz/i.test(s.name));
    assert.equal(stream.length, 1);
    assert.equal(stream[0]?.documentCount, 2);
    await wipe(userId);
  });

  await test("Internet 30 puis 35 sans remplacement → 1 ligne (montant récent, pas la somme)", async () => {
    const userId = await fresh("ambig");
    await addDoc(userId, {
      org: "Orange",
      title: "Orange Internet V1",
      amounts: ["30 EUR"],
      text: "Orange Internet fibre abonnement mensuel 30 EUR. ".repeat(8),
      analyzedAt: "2026-01-01T10:00:00.000Z",
    });
    await addDoc(userId, {
      org: "Orange",
      title: "Orange Internet V2",
      amounts: ["35 EUR"],
      text: "Orange Internet fibre abonnement mensuel 35 EUR. ".repeat(8),
      analyzedAt: "2026-03-01T10:00:00.000Z",
    });
    const subs = await listSubscriptionInsights(userId);
    const internet = subs.filter(
      (s) => /orange/i.test(s.name) && s.productKey === "internet",
    );
    assert.equal(
      internet.length,
      1,
      `attendu 1 ligne (pas de double comptage), got ${internet.length}`,
    );
    assert.equal(internet[0]?.monthlyEur, 35);
    assert.equal(internet[0]?.documentCount, 2);
    const dash = await buildPremiumMemoryDashboard(userId);
    assert.equal(dash.monthlySpendEur, 35);
    await wipe(userId);
  });

  await test("réindex même documentId : V1→V2 remplace (35, pas 65)", async () => {
    const userId = await fresh("reidx");
    const documentId = `doc-reidx-${randomUUID().slice(0, 6)}`;
    await addDoc(userId, {
      documentId,
      org: "Orange",
      title: "Orange Internet",
      amounts: ["30 EUR"],
      text: "Orange Internet fibre abonnement mensuel 30 EUR. ".repeat(8),
      analyzedAt: "2026-01-01T10:00:00.000Z",
    });
    assert.equal((await buildPremiumMemoryDashboard(userId)).monthlySpendEur, 30);

    const reindex: HistoryRecord = {
      id: `hist-${randomUUID().slice(0, 8)}`,
      userId,
      documentId,
      fileName: "Orange-Internet-v2.pdf",
      displayName: "Orange Internet V2",
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
        title: "Orange Internet V2",
        summary: "Orange Internet fibre 35",
        date: "01/03/2026",
        dates: ["01/03/2026"],
        people: [],
        organizations: ["Orange"],
        amounts: ["35 EUR"],
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
        "Orange Internet fibre abonnement mensuel 35 EUR. ".repeat(10),
      folderId: null,
      analysisPhase: "complete",
    };
    await upsertMemoryFromHistoryRecord(reindex);
    const dash = await buildPremiumMemoryDashboard(userId);
    assert.equal(dash.monthlySpendEur, 35);
    assert.equal(await getCorpusSize(userId), 1);
    await wipe(userId);
  });

  await test("suppression multi-docs : reste intact", async () => {
    const userId = await fresh("del");
    const a = await addDoc(userId, {
      org: "Orange",
      title: "Orange Internet",
      amounts: ["30 EUR"],
      text: "Orange Internet fibre abonnement mensuel 30 EUR. ".repeat(8),
    });
    const b = await addDoc(userId, {
      org: "Orange",
      title: "Orange Mobile",
      amounts: ["20 EUR"],
      text: "Orange Mobile forfait mobile abonnement mensuel 20 EUR. ".repeat(8),
    });
    await addDoc(userId, {
      org: "EDF",
      title: "EDF Elec",
      amounts: ["40 EUR"],
      text: "EDF électricité abonnement mensuel 40 EUR. ".repeat(8),
    });
    assert.equal((await buildPremiumMemoryDashboard(userId)).monthlySpendEur, 90);
    await deleteHistoryRecord(userId, a.id);
    let dash = await buildPremiumMemoryDashboard(userId);
    assert.equal(dash.monthlySpendEur, 60);
    await deleteHistoryRecord(userId, b.id);
    dash = await buildPremiumMemoryDashboard(userId);
    assert.equal(dash.monthlySpendEur, 40);
    assert.equal(await getCorpusSize(userId), 1);
    await wipe(userId);
  });

  await test("plusieurs montants sans ancrage → hors dépenses", async () => {
    const userId = await fresh("multi-amt");
    await addDoc(userId, {
      org: "MultiAmt",
      amounts: ["30 EUR", "50 EUR", "360 EUR"],
      text: "Document MultiAmt avec 30 EUR puis 50 EUR puis 360 EUR sans etiquette mensuelle claire. ".repeat(
        6,
      ),
    });
    // Période peut être absente → 0 ; si période détectée mais multi-montants → pick null → 0
    const dash = await buildPremiumMemoryDashboard(userId);
    assert.equal(dash.monthlySpendEur, null);
    await wipe(userId);
  });

  await test("invariants : relations / corpus / signaux", async () => {
    const userId = await fresh("inv");
    await addDoc(userId, {
      org: "Alpha",
      amounts: ["10 EUR"],
      text: "Alpha abonnement mensuel 10 EUR. ".repeat(8),
    });
    await addDoc(userId, {
      org: "Beta",
      amounts: ["12 EUR"],
      text: "Beta abonnement mensuel 12 EUR. ".repeat(8),
    });
    const corpus = await getCorpusSize(userId);
    const history = await listHistoryRecords(userId);
    assert.equal(corpus, history.length);

    const relations = await listAllRelations(userId);
    for (const r of relations) {
      const from = await getMemoryDocument(userId, r.fromDocId);
      const to = await getMemoryDocument(userId, r.toDocId);
      assert.ok(from, `relation ${r.id} fromDoc manquant`);
      assert.ok(to, `relation ${r.id} toDoc manquant`);
    }

    const dash = await buildPremiumMemoryDashboard(userId);
    for (const s of dash.topSubscriptions) {
      if (s.primaryDocumentId) {
        assert.ok(
          await getMemoryDocument(userId, s.primaryDocumentId),
          "abonnement source inexistante",
        );
        assert.ok(
          await loadRelationSignals(userId, s.primaryDocumentId),
          "signaux manquants",
        );
      }
    }
    for (const sav of dash.topSavings) {
      assert.ok(
        await getMemoryDocument(userId, sav.documentId),
        "économie doc source manquant",
      );
    }
    await wipe(userId);
  });

  await test("reconstruction : purge + re-upsert ≡ état", async () => {
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
    await addDoc(userId, {
      org: "EDF",
      amounts: ["100 EUR"],
      text: "Facture EDF ponctuelle 100 EUR. ".repeat(6),
      category: "facture",
    });

    const before = await buildPremiumMemoryDashboard(userId);
    const records = await listHistoryRecords(userId);
    assert.ok(records.length >= 3);

    for (const r of records) {
      await purgeMemoryForDocument(userId, r.documentId);
    }
    assert.equal(await getCorpusSize(userId), 0);

    for (const r of records) {
      const full = await getHistoryRecord(userId, r.id);
      assert.ok(full);
      await upsertMemoryFromHistoryRecord({
        ...full,
        analysisPhase: "complete",
      });
    }

    const after = await buildPremiumMemoryDashboard(userId);
    assert.equal(after.monthlySpendEur, before.monthlySpendEur);
    assert.equal(after.subscriptionCount, before.subscriptionCount);
    assert.equal(await getCorpusSize(userId), records.length);
    await wipe(userId);
  });

  await test("isolation utilisateurs", async () => {
    const a = await fresh("ua");
    const b = await fresh("ub");
    await addDoc(a, {
      org: "SecretA",
      amounts: ["99 EUR"],
      text: "SecretA abonnement mensuel 99 EUR. ".repeat(8),
    });
    await addDoc(b, {
      org: "SecretB",
      amounts: ["11 EUR"],
      text: "SecretB abonnement mensuel 11 EUR. ".repeat(8),
    });
    const dashA = await buildPremiumMemoryDashboard(a);
    const dashB = await buildPremiumMemoryDashboard(b);
    assert.equal(dashA.monthlySpendEur, 99);
    assert.equal(dashB.monthlySpendEur, 11);
    assert.ok(
      dashA.topSubscriptions.every((s) => !/secretb/i.test(s.name)),
    );
    assert.ok(
      dashB.topSubscriptions.every((s) => !/secreta/i.test(s.name)),
    );
    await wipe(a);
    await wipe(b);
  });

  await test("contrat possibly_replaced exclu des dépenses", async () => {
    const userId = await fresh("repl");
    const documentId = `doc-old-${randomUUID().slice(0, 6)}`;
    await addDoc(userId, {
      documentId,
      org: "ReplCo",
      amounts: ["40 EUR"],
      text: "ReplCo abonnement mensuel 40 EUR. ".repeat(8),
      analyzedAt: "2026-01-01T10:00:00.000Z",
    });
    const node = (await getMemoryDocument(userId, documentId)) as MemoryDocumentNode;
    const { saveMemoryDocument } = await import(
      "@/services/memory/document-store"
    );
    node.status = "possibly_replaced";
    await saveMemoryDocument(userId, node);
    const dash = await buildPremiumMemoryDashboard(userId);
    assert.equal(dash.monthlySpendEur, null);
    await wipe(userId);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
