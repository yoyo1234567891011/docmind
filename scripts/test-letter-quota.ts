/**
 * Agent courrier — Free bloqué, payants quota = analyses.
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
  assert.equal(pro.letter, pro.analyze, "Payant : letter = analyze");
  assert.ok(planHasLetterAgent("pro"));
  assert.ok(planHasLetterAgent("basique"));
  console.log("  ok  entitlements + quotas par plan");

  const freeUser = await fresh("free");
  assert.equal(await hasEntitlement(freeUser, "letter_agent"), false);
  console.log("  ok  Free bloqué (entitlement)");

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
  assert.ok(analyzeItem && !analyzeItem.unlimited);
  for (let i = 0; i < analyzeItem.limit; i++) {
    await consumeQuota(paidUser, "analyze");
  }

  let blocked = false;
  try {
    await assertQuotaAvailable(paidUser, "analyze");
  } catch (error) {
    blocked = error instanceof Error && /analyses/i.test(error.message);
  }
  assert.ok(blocked, "payant quota 0 → bloqué");
  console.log("  ok  quota épuisé → bloqué");

  await wipe(paidUser);
  const refundUser = await fresh("refund");
  await upsertSubscriptionPatch(refundUser, {
    plan: "basique",
    status: "active",
  });
  await consumeQuota(refundUser, "analyze");
  assert.equal(
    (await getQuotaStatus(refundUser)).items.find((i) => i.metric === "analyze")
      ?.used,
    1,
  );
  await refundQuota(refundUser, "analyze");
  assert.equal(
    (await getQuotaStatus(refundUser)).items.find((i) => i.metric === "analyze")
      ?.used,
    0,
  );
  console.log("  ok  consommation + remboursement analyze");

  const routeSrc = await readFile("src/app/api/letters/route.ts", "utf8");
  assert.ok(routeSrc.includes("hasEntitlement(user.id, \"letter_agent\""));
  assert.ok(routeSrc.includes('consumeQuota(user.id, "analyze")'));
  assert.ok(routeSrc.includes("refundQuota(user.id, \"analyze\")"));
  console.log("  ok  route API (gate + analyze + refund)");

  const draftSrc = await readFile("src/services/reply/draft.ts", "utf8");
  assert.ok(draftSrc.includes("requireEntitlement"));
  console.log("  ok  draft gate entitlement");

  await wipe(freeUser);
  await wipe(refundUser);
  console.log("\nall ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
