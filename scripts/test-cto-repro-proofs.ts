/**
 * Preuves reproductibles — findings CTO retenus uniquement.
 * Chaque test échoue sur le code bugué et passe après le patch minimal.
 */
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";

import { requireOllama } from "../e2e/helpers/env";
import { withKeyedLock } from "../src/lib/keyed-lock";
import { getClientIp } from "../src/lib/request-ip";
import { wipeUserLocalData } from "../src/services/account/delete-account";
import {
  ensureUserWorkspace,
  resetUserWorkspaceCache,
} from "../src/services/auth/workspace";
import { createDailyBackup } from "../src/services/backup/backup";
import { listAppEvents } from "../src/services/beta/app-events";
import { createErrorReport } from "../src/services/beta/error-reports-store";
import { listErrorReports } from "../src/services/beta/error-reports-store";
import { createFeedback } from "../src/services/beta/feedback-store";
import { listFeedback } from "../src/services/beta/feedback-store";
import { applyStripeSubscription } from "../src/services/billing/apply-subscription";
import { entitlementsFailOpen } from "../src/services/billing/entitlements";
import { getUserSubscription } from "../src/services/billing/store";

type RedisGlobal = typeof globalThis & {
  __docmindRedis?: {
    set: (...args: unknown[]) => Promise<unknown>;
    eval: (...args: unknown[]) => Promise<unknown>;
  } | null;
  __docmindRedisInitAttempted?: boolean;
};

async function withEnv(
  env: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** C1 — ESLint rules-of-hooks ne doit pas casser les fichiers .ts serveur. */
async function proofC1BuildEslint() {
  const { execSync } = await import("node:child_process");
  try {
    execSync("npx eslint src/config/persistence.ts src/lib/rate-limit.ts", {
      cwd: process.cwd(),
      stdio: "pipe",
      encoding: "utf8",
    });
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    assert.fail(
      `C1: eslint doit passer sur persistence.ts + rate-limit.ts. Sortie:\n${out}`,
    );
  }
  console.log("OK C1 eslint .ts serveur");
}

/**
 * M1 — Redis configuré + lease refusé → withKeyedLock doit échouer
 * (pas exécuter fn en fail-open).
 */
async function proofM1KeyedLockFailClosed() {
  const g = globalThis as RedisGlobal;
  const prevRedis = g.__docmindRedis;
  const prevAttempted = g.__docmindRedisInitAttempted;

  await withEnv({ REDIS_URL: "redis://127.0.0.1:59999" }, async () => {
    g.__docmindRedis = {
      set: async () => null, // NX toujours refusé
      eval: async () => 0,
    };
    g.__docmindRedisInitAttempted = true;

    let ran = false;
    await assert.rejects(
      () =>
        withKeyedLock(
          `cto-lock-${Date.now()}`,
          async () => {
            ran = true;
            return 1;
          },
          { ttlMs: 120 },
        ),
      /LOCK_TIMEOUT|verrou|lock/i,
    );
    assert.equal(ran, false, "fn ne doit pas tourner sans lease Redis");
  });

  g.__docmindRedis = prevRedis;
  g.__docmindRedisInitAttempted = prevAttempted;
  console.log("OK M1 keyed-lock fail-closed");
}

/** M2 — event Stripe plus ancien ne doit pas restaurer Premium. */
async function proofM2StripeEventOrder() {
  const userId = `cto-stripe-${Date.now()}`;
  resetUserWorkspaceCache();
  await ensureUserWorkspace(userId);

  await withEnv(
    {
      DOCMIND_STORAGE: "fs",
      STRIPE_SECRET_KEY: undefined,
      STRIPE_PRICE_PREMIUM: undefined,
    },
    async () => {
      const subId = "sub_cto_order";
      const canceledSub = {
        id: subId,
        customer: "cus_cto",
        status: "canceled",
        cancel_at_period_end: false,
        cancel_at: null,
        canceled_at: 1_700_000_000,
        items: { data: [{ price: { id: "price_x" } }] },
        metadata: { plan: "premium" },
      };

      await applyStripeSubscription(userId, canceledSub as never, {
        id: "evt_deleted",
        type: "customer.subscription.deleted",
        created: 2_000,
      });

      let sub = await getUserSubscription(userId);
      assert.equal(sub.plan, "free");
      assert.equal(sub.status, "canceled");

      // Event plus ancien encore "active" — doit être ignoré
      const staleActiveSub = {
        id: subId,
        customer: "cus_cto",
        status: "active",
        cancel_at_period_end: false,
        cancel_at: null,
        canceled_at: null,
        items: { data: [{ price: { id: "price_x" } }] },
        metadata: { plan: "premium" },
      };
      await applyStripeSubscription(userId, staleActiveSub as never, {
        id: "evt_stale_updated",
        type: "customer.subscription.updated",
        created: 1_000,
      });

      sub = await getUserSubscription(userId);
      assert.equal(
        sub.plan,
        "free",
        "event stale active ne doit pas restaurer premium",
      );
      assert.equal(sub.status, "canceled");
    },
  );

  await rm(path.join(process.cwd(), "data", "users", userId), {
    recursive: true,
    force: true,
  }).catch(() => undefined);
  console.log("OK M2 Stripe event order");
}

/** M3 — FAIL_OPEN=1 interdit en environnement déployé. */
async function proofM3FailOpenDeployed() {
  await withEnv(
    {
      BILLING_ENTITLEMENTS_FAIL_OPEN: "1",
      STRIPE_SECRET_KEY: undefined,
      STRIPE_PRICE_PREMIUM: undefined,
      NEXT_PUBLIC_APP_ENV: "production",
      NODE_ENV: "production",
    },
    async () => {
      assert.equal(
        entitlementsFailOpen(),
        false,
        "FAIL_OPEN=1 ne doit pas ouvrir Premium en production",
      );
    },
  );
  console.log("OK M3 fail-open déployé");
}

/** M4 — delete compte anonymise feedback / reports / app-events. */
async function proofM4DeleteAnonymizesOpsStores() {
  const userId = `cto-rgpd-${Date.now()}`;
  resetUserWorkspaceCache();
  await ensureUserWorkspace(userId);

  await createFeedback({
    userId,
    email: "cto@example.com",
    category: "bug",
    message: "preuve rgpd feedback delete compte",
  });
  await createErrorReport({
    userId,
    email: "cto@example.com",
    kind: "bug",
    message: "preuve rgpd error report delete",
  });

  await withEnv(
    {
      DOCMIND_STORAGE: "fs",
      STRIPE_SECRET_KEY: undefined,
      STRIPE_PRICE_PREMIUM: undefined,
    },
    async () => {
      await wipeUserLocalData(userId);
    },
  );

  const feedback = await listFeedback(500);
  const reports = await listErrorReports(500);
  const events = await listAppEvents(500);

  const fb = feedback.filter((e) => e.message.includes("preuve rgpd feedback"));
  const rp = reports.filter((e) => e.message.includes("preuve rgpd error"));
  assert.ok(fb.length >= 1);
  assert.ok(rp.length >= 1);
  assert.ok(fb.every((e) => e.userId === null && e.email === null));
  assert.ok(rp.every((e) => e.userId === null && e.email === null));

  const stillIdentified = events.filter((e) => e.userId === userId);
  assert.equal(
    stillIdentified.length,
    0,
    "app-events ne doivent plus porter userId",
  );

  console.log("OK M4 delete anonymise stores ops");
}

/** M9 — backup FS interdit en mode persistent. */
async function proofM9BackupRefusesPersistent() {
  await withEnv(
    {
      DOCMIND_STORAGE: "persistent",
      DATABASE_URL: "postgresql://cto:cto@127.0.0.1:5432/cto",
      S3_BUCKET: "cto",
      S3_ACCESS_KEY_ID: "x",
      S3_SECRET_ACCESS_KEY: "y",
      S3_ENDPOINT: "http://127.0.0.1:9000",
    },
    async () => {
      await assert.rejects(
        () => createDailyBackup({ id: `cto-backup-${Date.now()}` }),
        /persistent|Postgres|S3/i,
      );
    },
  );
  console.log("OK M9 backup refuse persistent");
}

/** M12 — CI exige Ollama (pas de skip silencieux du cœur produit). */
async function proofM12CiRequiresOllama() {
  await withEnv(
    { CI: "true", E2E_REQUIRE_OLLAMA: undefined },
    async () => {
      assert.equal(
        requireOllama(),
        true,
        "CI=true doit exiger Ollama pour E2E",
      );
    },
  );
  await withEnv(
    { CI: undefined, E2E_REQUIRE_OLLAMA: undefined },
    async () => {
      assert.equal(
        requireOllama(),
        false,
        "hors CI, skip Ollama reste optionnel",
      );
    },
  );
  console.log("OK M12 CI require Ollama");
}

/** m1 — sans TRUST_PROXY, XFF ne doit pas créer un nouvel IP bucket. */
async function proofM1IpTrustProxy() {
  await withEnv({ TRUST_PROXY: undefined }, async () => {
    const a = getClientIp(
      new Request("http://localhost", {
        headers: { "x-forwarded-for": "1.1.1.1" },
      }),
    );
    const b = getClientIp(
      new Request("http://localhost", {
        headers: { "x-forwarded-for": "2.2.2.2" },
      }),
    );
    assert.equal(a, b, "sans TRUST_PROXY, XFF forgé ne doit pas changer l’IP");
    assert.equal(a, "unknown");
  });

  await withEnv({ TRUST_PROXY: "1" }, async () => {
    const a = getClientIp(
      new Request("http://localhost", {
        headers: { "x-forwarded-for": "1.1.1.1" },
      }),
    );
    assert.equal(a, "1.1.1.1");
  });
  console.log("OK m1 TRUST_PROXY IP");
}

async function main() {
  // Ordre : preuves indépendantes
  await proofC1BuildEslint();
  await proofM1KeyedLockFailClosed();
  await proofM2StripeEventOrder();
  await proofM3FailOpenDeployed();
  await proofM4DeleteAnonymizesOpsStores();
  await proofM9BackupRefusesPersistent();
  await proofM12CiRequiresOllama();
  await proofM1IpTrustProxy();
  console.log("\nOK test-cto-repro-proofs — 8 findings prouvés");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
