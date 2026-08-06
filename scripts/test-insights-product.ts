/**
 * Insights produit — lecture mémoire, sans mutation du moteur.
 */
import assert from "assert";
import { rm } from "fs/promises";

import { userDataDir } from "../src/config/paths";
import {
  ensureUserWorkspace,
  resetUserWorkspaceCache,
} from "../src/services/auth/workspace";
import {
  buildFinanceInsight,
  buildMemoryDigest,
  buildPremiumMemoryDashboard,
  listRelationLetterIntents,
  listSavingsOpportunities,
  listSubscriptionInsights,
} from "../src/services/insights";
import { upsertMemoryFromHistoryRecord } from "../src/services/memory";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import type { HistoryRecord } from "../src/types";
import { EMPTY_READY_REPLY } from "../src/types/reply";

function makeRecord(
  userId: string,
  documentId: string,
  opts: {
    category: HistoryRecord["classification"]["category"];
    title: string;
    org: string;
    text: string;
    amounts: string[];
    analyzedAt: string;
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
    createdAt: opts.analyzedAt,
    classification: {
      category: opts.category,
      label: opts.category,
      confidence: 0.9,
    },
    analysis: {
      document_type: opts.title,
      title: opts.title,
      summary: opts.text.slice(0, 120),
      date: "01/01/2025",
      dates: ["01/01/2025"],
      people: [],
      organizations: [opts.org],
      amounts: opts.amounts,
      deadlines: ["Échéance paiement 15/08/2026"],
      important_points: ["Préavis de résiliation : 30 jours"],
      risks: [],
      actions: [],
      risk_score: 10,
      risk_level: "faible",
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
    analyzedAt: opts.analyzedAt,
    extractedText: opts.text,
    folderId: null,
    analysisPhase: "complete",
  };
}

async function main() {
  resetUserWorkspaceCache();
  const userId = `insights-${Date.now()}`;
  await ensureUserWorkspace(userId);

  const textA = `
CONTRAT NETFLIX STANDARD
Prestataire : Netflix International
Abonnement mensuel : 13,49 EUR
Adresse : 1 rue Test
`.repeat(3);
  const textB = `
ABONNEMENT NETFLIX STANDARD
Prestataire : Netflix International
Montant : 13,60 EUR mensuel
`.repeat(3);

  await upsertMemoryFromHistoryRecord(
    makeRecord(userId, "netflix-a", {
      category: "contrat",
      title: "Netflix A",
      org: "Netflix International",
      text: textA,
      amounts: ["13,49 €"],
      analyzedAt: "2025-01-01T10:00:00.000Z",
    }),
  );
  await upsertMemoryFromHistoryRecord(
    makeRecord(userId, "netflix-b", {
      category: "contrat",
      title: "Netflix B",
      org: "Netflix International",
      text: textB,
      amounts: ["13,60 €"],
      analyzedAt: "2025-02-01T10:00:00.000Z",
    }),
  );

  const subs = await listSubscriptionInsights(userId);
  assert.ok(subs.some((s) => /netflix/i.test(s.name)), "abonnement Netflix");
  assert.ok(
    subs.some((s) => (s.monthlyEur ?? 0) > 0),
    "montant mensuel",
  );

  const finance = await buildFinanceInsight(userId);
  assert.ok(finance.monthlyTotalEur > 0, "finance mensuelle");

  const savings = await listSavingsOpportunities(userId);
  assert.ok(Array.isArray(savings), "savings array");

  const digest = await buildMemoryDigest(userId, "week");
  assert.ok(digest.summary.length > 0, "digest summary");

  const letters = await listRelationLetterIntents(userId);
  assert.ok(Array.isArray(letters), "letter intents");

  const premium = await buildPremiumMemoryDashboard(userId);
  assert.ok(premium.uniqueValuePoints.length >= 3, "premium value points");
  assert.ok(premium.subscriptionCount >= 1, "premium subs");

  console.log(
    JSON.stringify(
      {
        ok: true,
        subscriptions: subs.length,
        monthly: finance.monthlyTotalEur,
        savings: savings.length,
        letters: letters.length,
        premiumPoints: premium.uniqueValuePoints.length,
      },
      null,
      2,
    ),
  );

  await rm(userDataDir(userId), { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
