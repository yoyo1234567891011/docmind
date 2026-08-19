/**
 * Vérification rapide des quotas Free/Premium (analyses/mois).
 * Usage: npx tsx scripts/verify-quota-limits.ts
 */
import assert from "node:assert/strict";

import { loadEnvFiles } from "./lib/load-env-files";
import { getPlanQuotas } from "../src/config/quotas";
import { formatAnalyzeQuotaRemaining } from "../src/lib/quotas/display";
import { AppError } from "../src/lib/errors";
import { ensureUserWorkspace } from "../src/services/auth/workspace";
import {
  consumeQuota,
  getQuotaStatus,
  quotaExceededMessage,
} from "../src/services/quotas/enforce";

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

async function main() {
  console.log("=== Quota limits verification ===\n");

  // 1. Defaults config
  delete process.env.QUOTA_FREE_ANALYZE;
  delete process.env.QUOTA_PREMIUM_ANALYZE;
  assert.equal(getPlanQuotas("free").analyze, 20, "Free default = 20");
  assert.equal(getPlanQuotas("premium").analyze, 200, "Premium default = 200");
  console.log("OK config defaults (20 Free / 200 Premium)");

  // 2. Display helper
  assert.equal(
    formatAnalyzeQuotaRemaining({
      metric: "analyze",
      used: 8,
      limit: 20,
      remaining: 12,
      unlimited: false,
    }),
    "12 analyses restantes ce mois",
  );
  assert.equal(
    formatAnalyzeQuotaRemaining({
      metric: "analyze",
      used: 20,
      limit: 20,
      remaining: 0,
      unlimited: false,
    }),
    "0 analyse restante ce mois",
  );
  console.log("OK formatAnalyzeQuotaRemaining");

  // 3. Messages FR
  const freeMsg = quotaExceededMessage(
    {
      plan: "free",
      month: "2026-08",
      items: [
        {
          metric: "analyze",
          used: 20,
          limit: 20,
          remaining: 0,
          unlimited: false,
        },
      ],
    },
    "analyze",
  );
  assert.match(freeMsg, /20 analyses du mois/);
  assert.match(freeMsg, /Premium/);

  const premiumMsg = quotaExceededMessage(
    {
      plan: "premium",
      month: "2026-08",
      items: [
        {
          metric: "analyze",
          used: 200,
          limit: 200,
          remaining: 0,
          unlimited: false,
        },
      ],
    },
    "analyze",
  );
  assert.match(premiumMsg, /Quota Premium atteint/);
  console.log("OK quotaExceededMessage (FR)");

  // 4. Enforcement (PG ou FS selon DOCMIND_STORAGE)
  if (!process.env.DATABASE_URL?.trim() && process.env.DOCMIND_STORAGE === "persistent") {
    console.warn("SKIP enforcement: DATABASE_URL absent");
  } else {
    await withEnv(
      {
        BILLING_ENTITLEMENTS_FAIL_OPEN: "0",
        QUOTA_FREE_ANALYZE: "2",
      },
      async () => {
        const userId = `verify-quota-${Date.now()}`;
        await ensureUserWorkspace(userId);
        await consumeQuota(userId, "analyze");
        await consumeQuota(userId, "analyze");

        let blocked = false;
        let code = "";
        try {
          await consumeQuota(userId, "analyze");
        } catch (error) {
          assert.ok(error instanceof AppError);
          code = error.code;
          blocked = true;
        }
        assert.ok(blocked, "3e analyse doit être bloquée");
        assert.equal(code, "QUOTA_EXCEEDED", "code erreur QUOTA_EXCEEDED");

        const status = await getQuotaStatus(userId);
        assert.equal(status.plan, "free");
        const analyze = status.items.find((i) => i.metric === "analyze");
        assert.equal(analyze?.used, 2);
        assert.equal(analyze?.limit, 2);
        assert.equal(analyze?.remaining, 0);
      },
    );
    console.log("OK consumeQuota + getQuotaStatus (enforcement)");
  }

  // 5. Stats DB (sans PII — agrégats seulement)
  if (process.env.DATABASE_URL?.trim()) {
    const pg = await import("pg");
    const c = new pg.default.Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PG_SSL_REJECT_UNAUTHORIZED === "0"
        ? { rejectUnauthorized: false }
        : undefined,
    });
    await c.connect();
    const month = new Date().toISOString().slice(0, 7);
    const stats = await c.query(
      `select count(*)::int as users_tracked,
              coalesce(sum((data->>'analyze')::int), 0)::int as total_analyses,
              coalesce(max((data->>'analyze')::int), 0)::int as max_per_user
       from public.app_usage
       where month = $1`,
      [month],
    );
    await c.end();
    console.log(
      `OK DB app_usage (${month}):`,
      JSON.stringify(stats.rows[0]),
    );
  }

  console.log("\n=== All verifiable checks passed ===");
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
