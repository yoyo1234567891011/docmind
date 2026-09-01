/**
 * Mes abonnements — montants fiables, agrégats sans faux 0 €.
 *
 * Usage: npm run test:subscriptions-display
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
  buildFinanceInsight,
  listSubscriptionInsights,
} from "@/services/insights";
import { upsertMemoryFromHistoryRecord } from "@/services/memory";
import { RISK_CRITERIA } from "@/services/risk/criteria";
import type { HistoryRecord } from "@/types";
import { EMPTY_READY_REPLY } from "@/types/reply";

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

async function wipe(userId: string) {
  await rm(userDataDir(userId), { recursive: true, force: true });
}

async function fresh(label: string) {
  const userId = `subdisp-${label}-${randomUUID().slice(0, 8)}`;
  resetUserWorkspaceCache();
  await wipe(userId);
  await ensureUserWorkspace(userId);
  return userId;
}

async function addDoc(
  userId: string,
  opts: {
    org: string;
    title: string;
    category?: HistoryRecord["classification"]["category"];
    amounts: string[];
    text: string;
    analyzedAt?: string;
  },
) {
  const documentId = `doc-${randomUUID().slice(0, 8)}`;
  const category = opts.category ?? "contrat";
  const record: HistoryRecord = {
    id: `hist-${documentId}`,
    userId,
    documentId,
    fileName: `${opts.org}.pdf`,
    displayName: opts.title,
    favorite: false,
    tagIds: [],
    createdAt: opts.analyzedAt ?? new Date().toISOString(),
    classification: { category, label: category, confidence: 0.9 },
    analysis: {
      document_type: category,
      title: opts.title,
      summary: opts.text.slice(0, 160),
      date: "01/02/2026",
      dates: ["01/02/2026"],
      people: [],
      organizations: [opts.org],
      amounts: opts.amounts,
      deadlines: ["Échéance renouvellement 15/08/2026"],
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
    analyzedAt: opts.analyzedAt ?? new Date().toISOString(),
    extractedText: opts.text,
    folderId: null,
    analysisPhase: "complete",
  };
  await upsertMemoryFromHistoryRecord(record);
  return { documentId, record };
}

function sumReliable(
  subs: Awaited<ReturnType<typeof listSubscriptionInsights>>,
): number | null {
  let sum = 0;
  let has = false;
  for (const s of subs) {
    if (s.monthlyEur != null && s.monthlyEur > 0) {
      sum += s.monthlyEur;
      has = true;
    }
  }
  return has ? Math.round(sum * 100) / 100 : null;
}

async function main() {
  console.log("subscriptions display\n");

  // 1. Assurance auto — prime annuelle → ~58,33 €/mois
  const autoUser = await fresh("auto");
  await addDoc(autoUser, {
    org: "MAIF",
    title: "Assurance auto MAIF",
    category: "assurance",
    amounts: ["700 EUR", "50 EUR"],
    text: [
      "Contrat assurance automobile MAIF.",
      "Prime annuelle totale : 700 EUR par an.",
      "Franchise accident : 50 EUR.",
    ].join(" "),
  });
  const autoSubs = await listSubscriptionInsights(autoUser);
  const auto = autoSubs.find((s) => /maif/i.test(s.name));
  assert.ok(auto, "ligne MAIF");
  assert.equal(auto.productKey, "assurance_auto");
  assert.equal(auto.monthlyEur, 58.33);
  assert.equal(auto.annualEur, 699.96);
  const autoFinance = await buildFinanceInsight(autoUser);
  assert.equal(autoFinance.monthlyTotalEur, 58.33);
  await wipe(autoUser);
  console.log("  ok  assurance auto");

  // 2. Box internet Orange — 39,99 €/mois
  const orangeUser = await fresh("orange");
  await addDoc(orangeUser, {
    org: "Orange",
    title: "Orange Livebox Fibre",
    amounts: ["39,99 EUR"],
    text: "Contrat Orange Livebox Fibre. Abonnement mensuel 39,99 EUR par mois. ".repeat(
      6,
    ),
  });
  const orangeSubs = await listSubscriptionInsights(orangeUser);
  const orange = orangeSubs.find(
    (s) => /orange/i.test(s.name) && s.productKey === "internet",
  );
  assert.ok(orange, "ligne Orange Internet");
  assert.equal(orange.monthlyEur, 39.99);
  assert.equal(sumReliable(orangeSubs), 39.99);
  await wipe(orangeUser);
  console.log("  ok  box internet Orange");

  // 3. Relevé bancaire — frais mensuels 9,90 €
  const bankUser = await fresh("bank");
  await addDoc(bankUser, {
    org: "BNP Paribas",
    title: "Relevé compte courant",
    category: "banque",
    amounts: ["9,90 EUR", "1250 EUR"],
    text: [
      "Relevé BNP Paribas.",
      "Frais de tenue de compte mensuels : 9,90 EUR par mois.",
      "Solde au 01/02/2026 : 1250 EUR.",
    ].join(" "),
  });
  const bankSubs = await listSubscriptionInsights(bankUser);
  const bank = bankSubs.find((s) => /bnp/i.test(s.name));
  assert.ok(bank, "ligne BNP");
  assert.equal(bank.monthlyEur, 9.9);
  await wipe(bankUser);
  console.log("  ok  relevé frais mensuels");

  // 4. Contrepartie sans période → pas de faux 0 € global
  const ambigUser = await fresh("ambig");
  await addDoc(ambigUser, {
    org: "MysteryCorp",
    title: "Document ambigu",
    amounts: ["500 EUR"],
    text: "Document MysteryCorp montant 500 EUR sans periodicite explicite. ".repeat(
      6,
    ),
  });
  const ambigSubs = await listSubscriptionInsights(ambigUser);
  assert.ok(ambigSubs.length >= 1);
  assert.equal(ambigSubs[0]?.monthlyEur, null);
  const ambigFinance = await buildFinanceInsight(ambigUser);
  assert.equal(ambigFinance.monthlyTotalEur, null);
  await wipe(ambigUser);
  console.log("  ok  pas de faux 0 €");

  // 5. Contrat + facture même abo → 1 ligne, 1 montant
  const cfUser = await fresh("contrat-facture");
  await addDoc(cfUser, {
    org: "Orange",
    title: "Orange Livebox Fibre",
    category: "contrat",
    amounts: ["40 EUR"],
    text: "Contrat Orange Livebox Fibre abonnement mensuel 40 EUR par mois. ".repeat(
      6,
    ),
    analyzedAt: "2026-01-15T10:00:00.000Z",
  });
  await addDoc(cfUser, {
    org: "Orange",
    title: "Facture Orange janvier",
    category: "facture",
    amounts: ["40 EUR"],
    text: "Facture Orange janvier 2026. Montant mensuel 40 EUR par mois. ".repeat(4),
    analyzedAt: "2026-02-01T10:00:00.000Z",
  });
  const cfSubs = await listSubscriptionInsights(cfUser);
  const cfOrange = cfSubs.filter((s) => /orange/i.test(s.name));
  assert.equal(cfOrange.length, 1, `contrat+facture: attendu 1 ligne, got ${cfOrange.length}`);
  assert.equal(cfOrange[0]?.monthlyEur, 40);
  assert.equal(cfOrange[0]?.documentCount, 2);
  assert.equal(sumReliable(cfSubs), 40);
  await wipe(cfUser);
  console.log("  ok  contrat + facture dédupliqués");

  // 6. Deux relevés banque même frais → 1 ligne
  const bank2User = await fresh("bank-dup");
  await addDoc(bank2User, {
    org: "Banque Horizon",
    title: "Relevé janvier",
    category: "banque",
    amounts: ["9,90 EUR", "800 EUR"],
    text: "Relevé Banque Horizon. Frais de tenue de compte mensuels 9,90 EUR par mois. Solde 800 EUR. ".repeat(
      3,
    ),
    analyzedAt: "2026-01-10T10:00:00.000Z",
  });
  await addDoc(bank2User, {
    org: "Banque Horizon",
    title: "Relevé février",
    category: "banque",
    amounts: ["9,90 EUR", "820 EUR"],
    text: "Relevé Banque Horizon. Frais de tenue de compte mensuels 9,90 EUR par mois. Solde 820 EUR. ".repeat(
      3,
    ),
    analyzedAt: "2026-02-10T10:00:00.000Z",
  });
  const bank2Subs = await listSubscriptionInsights(bank2User);
  const horizon = bank2Subs.filter((s) => /horizon/i.test(s.name));
  assert.equal(horizon.length, 1, `2 relevés: attendu 1 ligne, got ${horizon.length}`);
  assert.equal(horizon[0]?.monthlyEur, 9.9);
  assert.equal(horizon[0]?.documentCount, 2);
  await wipe(bank2User);
  console.log("  ok  2 relevés banque dédupliqués");

  // 7. Orange mobile + Orange box → 2 lignes distinctes
  const dualUser = await fresh("orange-dual");
  await addDoc(dualUser, {
    org: "Orange",
    title: "Orange Mobile",
    amounts: ["20 EUR"],
    text: "Contrat Orange Mobile forfait mobile abonnement mensuel 20 EUR par mois. ".repeat(
      6,
    ),
    analyzedAt: "2026-01-01T10:00:00.000Z",
  });
  await addDoc(dualUser, {
    org: "Orange",
    title: "Orange Livebox",
    amounts: ["30 EUR"],
    text: "Contrat Orange Livebox fibre abonnement mensuel 30 EUR par mois. ".repeat(
      6,
    ),
    analyzedAt: "2026-01-01T10:00:00.000Z",
  });
  const dualSubs = await listSubscriptionInsights(dualUser);
  const dualOrange = dualSubs.filter((s) => /orange/i.test(s.name));
  assert.equal(dualOrange.length, 2, `mobile+box: attendu 2 lignes, got ${dualOrange.length}`);
  assert.equal(sumReliable(dualSubs), 50);
  await wipe(dualUser);
  console.log("  ok  Orange mobile + box séparés");

  // 8. Doc remplacé (possibly_replaced) + version active → 1 ligne, montant actif
  const replUser = await fresh("replaced");
  const { getMemoryDocument, saveMemoryDocument } = await import(
    "@/services/memory/document-store"
  );
  const v1 = await addDoc(replUser, {
    org: "StreamZ",
    title: "StreamZ abonnement V1",
    amounts: ["30 EUR"],
    text: "Abonnement StreamZ mensuel 30 EUR par mois. ".repeat(6),
    analyzedAt: "2026-01-01T10:00:00.000Z",
  });
  const v2 = await addDoc(replUser, {
    org: "StreamZ",
    title: "StreamZ abonnement V2",
    amounts: ["35 EUR"],
    text: "Abonnement StreamZ mensuel 35 EUR par mois. ".repeat(6),
    analyzedAt: "2026-03-01T10:00:00.000Z",
  });
  const v1Node = await getMemoryDocument(replUser, v1.documentId);
  assert.ok(v1Node);
  v1Node.status = "possibly_replaced";
  await saveMemoryDocument(replUser, v1Node);
  const replSubs = await listSubscriptionInsights(replUser);
  const stream = replSubs.filter((s) => /streamz/i.test(s.name));
  assert.equal(stream.length, 1, `remplacé: attendu 1 ligne, got ${stream.length}`);
  assert.equal(stream[0]?.monthlyEur, 35);
  assert.equal(stream[0]?.documentCount, 2);
  await wipe(replUser);
  console.log("  ok  doc remplacé → montant actif");

  console.log("\nall ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
