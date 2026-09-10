/**
 * Agent courrier — Free bloqué, payants quota letter indépendant d’analyze.
 *
 * Usage: npm run test:letter-quota
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { rm } from "node:fs/promises";

process.env.DOCMIND_STORAGE = "fs";
process.env.DOCMIND_FS_FALLBACK = "0";
process.env.BILLING_ENTITLEMENTS_FAIL_OPEN = "0";
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;
delete process.env.STRIPE_SECRET_KEY;

import { BILLING_PLANS } from "@/config/billing";
import { getPlanQuotas } from "@/config/quotas";
import { userDataDir } from "@/config/paths";
import {
  ensureUserWorkspace,
  resetUserWorkspaceCache,
} from "@/services/auth/workspace";
import { hasEntitlement, planHasLetterAgent } from "@/services/billing/entitlements";
import { upsertSubscriptionPatch } from "@/services/billing/store";
import {
  assertQuotaAvailable,
  consumeQuota,
  getQuotaStatus,
  refundQuota,
} from "@/services/quotas/enforce";

async function wipe(userId: string) {
  await rm(userDataDir(userId), { recursive: true, force: true });
}

async function fresh(label: string) {
  const userId = `letterq-${label}-${randomUUID().slice(0, 8)}`;
  resetUserWorkspaceCache();
  await wipe(userId);
  await ensureUserWorkspace(userId);
  return userId;
}

async function main() {
  console.log("letter quota\n");

  assert.ok(
    !BILLING_PLANS.free.entitlements.includes("letter_agent"),
    "Free sans letter_agent",
  );
  assert.ok(
    BILLING_PLANS.basique.entitlements.includes("letter_agent"),
    "Basique avec letter_agent",
  );

  const free = getPlanQuotas("free");
  assert.equal(free.letter, 0, "Free : 0 courrier affiché");
  const pro = getPlanQuotas("pro");
  assert.equal(pro.letter, pro.analyze, "Payant : plafond letter = analyze par défaut");
  assert.ok(planHasLetterAgent("pro"));
  assert.ok(planHasLetterAgent("basique"));
  console.log("  ok  entitlements + quotas par plan");

  const freeUser = await fresh("free");
  assert.equal(await hasEntitlement(freeUser, "letter_agent"), false);
  console.log("  ok  Free bloqué (entitlement)");

  // Analyze épuisé ≠ letter bloqué
  const paidUser = await fresh("paid");
  await upsertSubscriptionPatch(paidUser, {
    plan: "pro",
    status: "active",
    stripeCustomerId: "cus_test",
    stripeSubscriptionId: "sub_test",
  });
  const paidStatus = await getQuotaStatus(paidUser);
  assert.equal(paidStatus.plan, "pro");
  const analyzeItem = paidStatus.items.find((i) => i.metric === "analyze");
  const letterItem = paidStatus.items.find((i) => i.metric === "letter");
  assert.ok(analyzeItem && !analyzeItem.unlimited);
  assert.ok(letterItem && !letterItem.unlimited);
  for (let i = 0; i < analyzeItem.limit; i++) {
    await consumeQuota(paidUser, "analyze");
  }

  let analyzeBlocked = false;
  try {
    await assertQuotaAvailable(paidUser, "analyze");
  } catch (error) {
    analyzeBlocked = error instanceof Error && /analyses/i.test(error.message);
  }
  assert.ok(analyzeBlocked, "analyze = 0 → bloqué");

  await assertQuotaAvailable(paidUser, "letter");
  const afterAnalyzeExhausted = await getQuotaStatus(paidUser);
  const letterAfter = afterAnalyzeExhausted.items.find((i) => i.metric === "letter");
  assert.ok(letterAfter && letterAfter.remaining === letterAfter.limit);
  console.log("  ok  analyze épuisé → letter encore dispo");

  await consumeQuota(paidUser, "letter");
  const afterLetter = await getQuotaStatus(paidUser);
  assert.equal(
    afterLetter.items.find((i) => i.metric === "letter")?.used,
    1,
  );
  assert.equal(
    afterLetter.items.find((i) => i.metric === "analyze")?.remaining,
    0,
  );
  console.log("  ok  consommer letter n’affecte pas analyze");

  for (let i = 1; i < letterItem.limit; i++) {
    await consumeQuota(paidUser, "letter");
  }
  let letterBlocked = false;
  try {
    await assertQuotaAvailable(paidUser, "letter");
  } catch (error) {
    letterBlocked =
      error instanceof Error && /courriers?/i.test(error.message);
  }
  assert.ok(letterBlocked, "letter = 0 → message quota courrier");
  console.log("  ok  letter épuisé → message courrier");

  await wipe(paidUser);

  const refundUser = await fresh("refund");
  await upsertSubscriptionPatch(refundUser, {
    plan: "basique",
    status: "active",
  });
  await consumeQuota(refundUser, "letter");
  assert.equal(
    (await getQuotaStatus(refundUser)).items.find((i) => i.metric === "letter")
      ?.used,
    1,
  );
  await refundQuota(refundUser, "letter");
  assert.equal(
    (await getQuotaStatus(refundUser)).items.find((i) => i.metric === "letter")
      ?.used,
    0,
  );
  console.log("  ok  consommation + remboursement letter");

  const routeSrc = await readFile("src/app/api/letters/route.ts", "utf8");
  assert.ok(routeSrc.includes('hasEntitlement(user.id, "letter_agent"'));
  assert.ok(routeSrc.includes('consumeQuota(user.id, "letter")'));
  assert.ok(routeSrc.includes('refundQuota(user.id, "letter")'));
  assert.ok(!routeSrc.includes('consumeQuota(user.id, "analyze")'));
  console.log("  ok  route API (gate + letter + refund)");

  const draftSrc = await readFile("src/services/reply/draft.ts", "utf8");
  assert.ok(draftSrc.includes("requireEntitlement"));
  console.log("  ok  draft gate entitlement");

  const panelSrc = await readFile(
    "src/components/documents/letter-draft-panel.tsx",
    "utf8",
  );
  assert.ok(panelSrc.includes("letterQuota"));
  assert.ok(panelSrc.includes("Quota courriers atteint"));
  assert.ok(!panelSrc.includes("partagent ce quota"));
  console.log("  ok  UI letter indépendant d’analyze");

  await wipe(freeUser);
  await wipe(refundUser);
  console.log("\nall ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
