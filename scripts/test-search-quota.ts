/**
 * Recherche — quota seulement si succès (hits ou 0 résultat) ; refund si échec.
 *
 * Usage: npm run test:search-quota
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";

process.env.DOCMIND_STORAGE = "fs";
process.env.DOCMIND_FS_FALLBACK = "0";
process.env.DOCMIND_FS_DUAL_WRITE = "0";
process.env.DOCMIND_SKIP_MEMORY_DUAL_WRITE = "1";
process.env.BILLING_ENTITLEMENTS_FAIL_OPEN = "0";
delete process.env.REDIS_URL;
delete process.env.KV_URL;
delete process.env.DATABASE_URL;
delete process.env.STRIPE_SECRET_KEY;

import { getPlanQuotas } from "@/config/quotas";
import { userDataDir } from "@/config/paths";
import {
  ensureUserWorkspace,
  resetUserWorkspaceCache,
} from "@/services/auth/workspace";
import { upsertSubscriptionPatch } from "@/services/billing/store";
import {
  consumeQuota,
  getQuotaStatus,
  pickQuotaItem,
  refundQuota,
} from "@/services/quotas/enforce";
import { runSmartSearch } from "@/services/search";
import { RISK_CRITERIA } from "@/services/risk/criteria";
import { saveHistoryRecord } from "@/services/history";
import { EMPTY_READY_REPLY } from "@/types/reply";

async function wipe(userId: string) {
  await rm(userDataDir(userId), { recursive: true, force: true });
}

async function fresh(label: string) {
  const userId = `searchq-${label}-${randomUUID().slice(0, 8)}`;
  resetUserWorkspaceCache();
  await wipe(userId);
  await ensureUserWorkspace(userId);
  await upsertSubscriptionPatch(userId, {
    plan: "premium",
    status: "active",
  });
  return userId;
}

function searchUsed(userId: string) {
  return getQuotaStatus(userId).then((s) => pickQuotaItem(s, "search")!);
}

/**
 * Miroir du contrat POST /api/search : débit → search → refund si throw.
 */
async function searchChargingQuota(
  userId: string,
  query: string,
  searchFn: () => ReturnType<typeof runSmartSearch>,
) {
  await consumeQuota(userId, "search");
  try {
    return await searchFn();
  } catch (error) {
    await refundQuota(userId, "search").catch(() => undefined);
    throw error;
  }
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

async function addFactureEdf(userId: string) {
  const documentId = `doc-${randomUUID().slice(0, 8)}`;
  await saveHistoryRecord(userId, {
    result: {
      documentId,
      classification: {
        category: "facture",
        label: "Facture",
        confidence: 0.9,
      },
      analysis: {
        document_type: "Facture",
        title: "Facture EDF mars",
        summary: "Facture d'électricité EDF.",
        date: "01/03/2026",
        dates: ["01/03/2026"],
        people: [],
        organizations: ["EDF"],
        amounts: ["62,40 €"],
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
      promptsUsed: [],
      phase: "complete",
    },
    fileName: "facture-edf.pdf",
    extractedText: "Facture EDF mars 62,40 EUR.",
  });
}

async function main() {
  console.log("search quota\n");

  assert.equal(getPlanQuotas("premium").search, 250);
  assert.equal(getPlanQuotas("free").search, 5);
  console.log("  ok  plafonds Premium 250 / Free 5 inchangés");

  const routeSrc = await readFile("src/app/api/search/route.ts", "utf8");
  assert.ok(routeSrc.includes('consumeQuota(user.id, "search")'));
  assert.ok(routeSrc.includes('refundQuota(user.id, "search")'));
  assert.ok(
    routeSrc.indexOf("await runSmartSearch(") >
      routeSrc.indexOf("await consumeQuota("),
  );
  assert.ok(
    routeSrc.indexOf("await refundQuota(") >
      routeSrc.indexOf("await runSmartSearch("),
  );
  console.log("  ok  route : consume → search → refund si échec");

  const uiSrc = await readFile(
    "src/components/search/smart-search-view.tsx",
    "utf8",
  );
  assert.ok(
    uiSrc.includes(
      "Exemples ci-dessous, ou tapez une question sur vos documents déjà",
    ),
  );
  console.log("  ok  empty state aide");

  // 1) Échec technique → quota stable (refund)
  const failUser = await fresh("fail");
  const beforeFail = await searchUsed(failUser);
  assert.equal(beforeFail.used, 0);
  assert.equal(beforeFail.limit, 250);
  let threw = false;
  try {
    await searchChargingQuota(failUser, "test", async () => {
      throw new Error("Recherche impossible (simulée)");
    });
  } catch {
    threw = true;
  }
  assert.ok(threw);
  const afterFail = await searchUsed(failUser);
  assert.equal(afterFail.used, beforeFail.used, "échec → used stable");
  assert.equal(afterFail.remaining, beforeFail.remaining);
  await wipe(failUser);
  console.log("  ok  échec → quota non consommé (refund)");

  // 2) 0 résultat légitime → quota -1
  const emptyUser = await fresh("empty");
  const beforeEmpty = await searchUsed(emptyUser);
  const emptyResult = await searchChargingQuota(emptyUser, "Factures EDF", () =>
    runSmartSearch({ userId: emptyUser, query: "Montre toutes les factures EDF." }),
  );
  assert.equal(emptyResult.total, 0, "corpus vide → 0 hit");
  const afterEmpty = await searchUsed(emptyUser);
  assert.equal(afterEmpty.used, beforeEmpty.used + 1);
  assert.equal(afterEmpty.remaining, beforeEmpty.remaining - 1);
  await wipe(emptyUser);
  console.log("  ok  0 résultat → quota -1");

  // 3) Succès avec hits → quota -1
  const hitUser = await fresh("hits");
  await addFactureEdf(hitUser);
  const beforeHits = await searchUsed(hitUser);
  const hitResult = await searchChargingQuota(hitUser, "edf", () =>
    runSmartSearch({
      userId: hitUser,
      query: "Montre toutes les factures EDF.",
    }),
  );
  assert.ok(hitResult.total >= 1, `attendu ≥1 hit, got ${hitResult.total}`);
  const afterHits = await searchUsed(hitUser);
  assert.equal(afterHits.used, beforeHits.used + 1);
  assert.equal(afterHits.remaining, beforeHits.remaining - 1);
  await wipe(hitUser);
  console.log("  ok  succès avec hits → quota -1");

  console.log("\nall ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
