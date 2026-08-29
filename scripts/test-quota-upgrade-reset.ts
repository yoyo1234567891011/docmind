/**
 * Vérifie le reset analyze/search lors d’un upgrade de palier.
 * Usage: npx tsx --tsconfig tsconfig.json scripts/test-quota-upgrade-reset.ts
 */
import assert from "node:assert/strict";

import { loadEnvFiles } from "./lib/load-env-files";
import { getPlanQuotas } from "../src/config/quotas";
import { isPlanTierUpgrade, planTierRank } from "../src/config/billing";
import { ensureUserWorkspace, resetUserWorkspaceCache } from "../src/services/auth/workspace";
import { applyStripeSubscription } from "../src/services/billing/apply-subscription";
import { upsertSubscriptionPatch } from "../src/services/billing/store";
import {
  consumeQuota,
  getQuotaStatus,
  pickQuotaItem,
} from "../src/services/quotas/enforce";
import { getUserUsage } from "../src/services/quotas/store";

loadEnvFiles();

function withEnv(
  env: Record<string, string>,
  fn: () => Promise<void>,
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

function mockStripeSub(plan: string): never {
  return {
    id: `sub_test_${plan}`,
    customer: "cus_test",
    status: "active",
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    items: { data: [{ price: { id: "price_test" } }] },
    metadata: { docmind_plan: plan },
    current_period_start: Math.floor(Date.now() / 1000),
    current_period_end: Math.floor(Date.now() / 1000) + 86_400 * 30,
  } as never;
}

async function main() {
  console.log("=== Quota upgrade reset ===\n");

  assert.equal(planTierRank("free"), 0);
  assert.equal(planTierRank("pro"), 2);
  assert.ok(isPlanTierUpgrade("free", "pro"));
  assert.ok(isPlanTierUpgrade("basique", "pro"));
  assert.ok(isPlanTierUpgrade("pro", "premium"));
  assert.ok(isPlanTierUpgrade("pro", "extra"));
  assert.ok(!isPlanTierUpgrade("pro", "pro"));
  assert.ok(!isPlanTierUpgrade("premium", "pro"));
  assert.ok(!isPlanTierUpgrade("extra", "premium"));
  console.log("OK plan tier ranks");

  await withEnv(
    {
      DOCMIND_STORAGE: "fs",
      BILLING_ENTITLEMENTS_FAIL_OPEN: "0",
      STRIPE_SECRET_KEY: "",
    },
    async () => {
      const userId = `quota-upgrade-${Date.now()}`;
      resetUserWorkspaceCache();
      await ensureUserWorkspace(userId);

      await upsertSubscriptionPatch(userId, {
        plan: "free",
        status: "active",
      });

      const freeLimits = getPlanQuotas("free");
      for (let i = 0; i < freeLimits.analyze; i++) {
        await consumeQuota(userId, "analyze");
      }
      for (let i = 0; i < freeLimits.search; i++) {
        await consumeQuota(userId, "search");
      }

      let status = await getQuotaStatus(userId);
      assert.equal(status.plan, "free");
      const analyzeBefore = pickQuotaItem(status, "analyze");
      const searchBefore = pickQuotaItem(status, "search");
      assert.equal(analyzeBefore?.remaining, 0);
      assert.equal(searchBefore?.remaining, 0);
      console.log("OK free quotas exhausted", {
        analyze: `${analyzeBefore?.used}/${analyzeBefore?.limit}`,
        search: `${searchBefore?.used}/${searchBefore?.limit}`,
      });

      await applyStripeSubscription(userId, mockStripeSub("pro"), {
        id: "evt_upgrade_pro",
        type: "customer.subscription.updated",
        created: Math.floor(Date.now() / 1000),
      });

      status = await getQuotaStatus(userId);
      assert.equal(status.plan, "pro");
      const proLimits = getPlanQuotas("pro");
      const analyzeAfter = pickQuotaItem(status, "analyze");
      const searchAfter = pickQuotaItem(status, "search");
      assert.equal(analyzeAfter?.used, 0);
      assert.equal(searchAfter?.used, 0);
      assert.equal(analyzeAfter?.remaining, proLimits.analyze);
      assert.equal(searchAfter?.remaining, proLimits.search);
      console.log("OK free → pro reset", {
        analyze: `${analyzeAfter?.remaining} restantes`,
        search: `${searchAfter?.remaining} restantes`,
      });

      // Consommer puis upgrade basique → pro (paid to paid)
      await consumeQuota(userId, "analyze");
      await consumeQuota(userId, "analyze");
      await applyStripeSubscription(userId, mockStripeSub("basique"), {
        id: "evt_downgrade_basique",
        type: "customer.subscription.updated",
        created: Math.floor(Date.now() / 1000) + 1,
      });
      let usage = await getUserUsage(userId);
      assert.equal(usage.analyze, 2, "downgrade ne reset pas");
      await applyStripeSubscription(userId, mockStripeSub("premium"), {
        id: "evt_upgrade_premium",
        type: "customer.subscription.updated",
        created: Math.floor(Date.now() / 1000) + 2,
      });
      usage = await getUserUsage(userId);
      assert.equal(usage.analyze, 0, "basique → premium reset analyze");
      assert.equal(usage.search, 0, "basique → premium reset search");
      console.log("OK paid upgrade reset, downgrade preserved usage");

      // Renouvellement même plan : pas de reset
      await consumeQuota(userId, "analyze");
      await applyStripeSubscription(userId, mockStripeSub("premium"), {
        id: "evt_renew_premium",
        type: "invoice.paid",
        created: Math.floor(Date.now() / 1000) + 3,
      });
      usage = await getUserUsage(userId);
      assert.equal(usage.analyze, 1, "renewal same plan keeps usage");
      console.log("OK same-plan renewal no reset");

      // Upload non reset
      await upsertSubscriptionPatch(userId, { plan: "free", status: "active" });
      for (let i = 0; i < 3; i++) {
        await consumeQuota(userId, "upload");
      }
      usage = await getUserUsage(userId);
      const uploadUsed = usage.upload;
      assert.ok(uploadUsed > 0);
      await applyStripeSubscription(userId, mockStripeSub("pro"), {
        id: "evt_upgrade_upload",
        type: "customer.subscription.updated",
        created: Math.floor(Date.now() / 1000) + 4,
      });
      usage = await getUserUsage(userId);
      assert.equal(usage.upload, uploadUsed, "upload inchangé à l’upgrade");
      assert.equal(usage.analyze, 0);
      console.log("OK upload not reset on upgrade");
    },
  );

  console.log("\n=== All quota upgrade checks passed ===");
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
