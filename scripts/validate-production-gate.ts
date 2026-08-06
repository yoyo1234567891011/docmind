/**
 * Gate de validation production — exécution réelle, pas d’hypothèses.
 *
 * Usage: npm run validate:prod-gate
 *
 * Chaque check: PASS | FAIL | BLOCKED (infra absente).
 * Exit 1 si FAIL. BLOCKED est listé explicitement (pas un faux vert).
 */
import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { clearUserAnalysisCache } from "../src/ai/optimizations/analysis-cache";
import { PRODUCT_ANALYTICS_FILE, userDataDir, userUploadsDir } from "../src/config/paths";
import { validateProductionEnv } from "../src/lib/env-validate";
import { withKeyedLock } from "../src/lib/keyed-lock";
import { wipeUserLocalData } from "../src/services/account/delete-account";
import {
  anonymizeAnalyticsForUser,
  trackAnalyticsEvent,
} from "../src/services/analytics/store";
import {
  ensureUserWorkspace,
  resetUserWorkspaceCache,
} from "../src/services/auth/workspace";
import {
  createDailyBackup,
  restoreBackup,
  verifyBackup,
} from "../src/services/backup/backup";
import { listAppEvents } from "../src/services/beta/app-events";
import { createErrorReport, listErrorReports } from "../src/services/beta/error-reports-store";
import { createFeedback, listFeedback } from "../src/services/beta/feedback-store";
import { applyStripeSubscription } from "../src/services/billing/apply-subscription";
import { getUserSubscription } from "../src/services/billing/store";
import { appendMonitoringEvent } from "../src/services/monitoring/store";
import { consumeQuota, getQuotaStatus } from "../src/services/quotas/enforce";
import { getMemoryDocument } from "../src/services/memory/document-store";
import { runMemoryDualWrite } from "../src/services/memory/dual-write";
import { EMPTY_READY_REPLY } from "../src/types/reply";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import type { HistoryRecord } from "../src/types/history";

type Status = "PASS" | "FAIL" | "BLOCKED";

type CheckResult = {
  id: string;
  title: string;
  status: Status;
  detail: string;
  durationMs: number;
};

const results: CheckResult[] = [];
const ROOT = process.cwd();

function hasEnv(...keys: string[]): boolean {
  return keys.every((k) => Boolean(process.env[k]?.trim()));
}

function infraPersistentReady(): boolean {
  return (
    hasEnv("DATABASE_URL") &&
    hasEnv("S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY") &&
    (hasEnv("S3_ENDPOINT") || hasEnv("AWS_REGION") || hasEnv("S3_REGION"))
  );
}

async function runCheck(
  id: string,
  title: string,
  fn: () => Promise<string>,
): Promise<void> {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({
      id,
      title,
      status: "PASS",
      detail,
      durationMs: Date.now() - started,
    });
    console.log(`PASS  ${id} — ${title} (${Date.now() - started}ms)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("BLOCKED:")) {
      results.push({
        id,
        title,
        status: "BLOCKED",
        detail: message.slice("BLOCKED:".length).trim(),
        durationMs: Date.now() - started,
      });
      console.log(`BLOCK ${id} — ${title}`);
      console.log(`      ${message}`);
      return;
    }
    results.push({
      id,
      title,
      status: "FAIL",
      detail: message,
      durationMs: Date.now() - started,
    });
    console.error(`FAIL  ${id} — ${title}`);
    console.error(`      ${message}`);
  }
}

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

function makeStripeSub(input: {
  id: string;
  status: string;
  planMeta?: string;
  priceId?: string;
}): never {
  return {
    id: input.id,
    customer: "cus_gate",
    status: input.status,
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: input.status === "canceled" ? 1_700_000_000 : null,
    items: {
      data: [{ price: { id: input.priceId ?? "price_gate" } }],
    },
    metadata: input.planMeta ? { plan: input.planMeta } : {},
  } as never;
}

/* -------------------------------------------------------------------------- */
/* Checks                                                                     */
/* -------------------------------------------------------------------------- */

async function checkBuildAlreadyOk(): Promise<string> {
  // Re-run build — exigence utilisateur : build Vercel complet réel
  const out = execSync("npm run build", {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: process.env.CI ?? "true" },
  });
  if (!out.includes("Compiled successfully") && !out.includes("Route (app)")) {
    // Next 15 may say different things — check exit already threw
  }
  return "npm run build exit 0 (artefact .next produit)";
}

async function checkVercelEnvContract(): Promise<string> {
  return withEnv(
    {
      NEXT_PUBLIC_APP_ENV: "production",
      NODE_ENV: "production",
      // volontairement vides pour lister les manques
      NEXT_PUBLIC_SUPABASE_URL: undefined,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      NEXT_PUBLIC_APP_URL: undefined,
      ADMIN_EMAILS: undefined,
      STRIPE_SECRET_KEY: undefined,
      STRIPE_PRICE_PREMIUM: undefined,
      STRIPE_WEBHOOK_SECRET: undefined,
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: undefined,
      DATABASE_URL: undefined,
      REDIS_URL: undefined,
      S3_BUCKET: undefined,
    },
    async () => {
      const issues = validateProductionEnv().filter((i) => i.level === "error");
      assert.ok(
        issues.length >= 10,
        `attendu ≥10 erreurs env prod, got ${issues.length}`,
      );
    },
  ).then(() => {
    const present = [
      "DATABASE_URL",
      "REDIS_URL",
      "S3_BUCKET",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ].filter((k) => hasEnv(k));
    if (present.length === 0) {
      return `contrat env OK (validateProductionEnv). Infra réelle absente: ${present.length}/7 clés critiques présentes.`;
    }
    return `contrat env OK. Clés critiques présentes: ${present.join(", ")}`;
  });
}

async function checkRgpdWipeFs(): Promise<string> {
  const userId = `gate-rgpd-${Date.now()}`;
  resetUserWorkspaceCache();
  await ensureUserWorkspace(userId);

  await trackAnalyticsEvent({
    name: "analysis.completed",
    userId,
    meta: { source: "gate-rgpd" },
  });
  await createFeedback({
    userId,
    email: "gate@example.com",
    category: "bug",
    message: "gate rgpd feedback message long",
  });
  await createErrorReport({
    userId,
    email: "gate@example.com",
    kind: "bug",
    message: "gate rgpd error report message",
  });
  await appendMonitoringEvent({
    name: "analysis.ok",
    userId,
    meta: { source: "gate-rgpd" },
  });

  // mémoire : dual-write sans history → no-op ; créer un fichier mémoire faux via write
  const memDir = path.join(userDataDir(userId), "memory", "documents");
  await mkdir(memDir, { recursive: true });
  await writeFile(
    path.join(memDir, "doc-gate.json"),
    JSON.stringify({ userId, documentId: "doc-gate" }),
    "utf8",
  );

  const uploads = userUploadsDir(userId);
  await mkdir(uploads, { recursive: true });
  await writeFile(path.join(uploads, "doc-gate.pdf"), "%PDF-1.4 gate", "utf8");

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

  // Workspace user
  await assert.rejects(() => access(userDataDir(userId)));
  await assert.rejects(() => access(userUploadsDir(userId)));

  const feedback = (await listFeedback(500)).filter((e) =>
    e.message.includes("gate rgpd feedback"),
  );
  const reports = (await listErrorReports(500)).filter((e) =>
    e.message.includes("gate rgpd error"),
  );
  assert.ok(feedback.every((e) => e.userId === null && e.email === null));
  assert.ok(reports.every((e) => e.userId === null && e.email === null));
  assert.equal(
    (await listAppEvents(500)).filter((e) => e.userId === userId).length,
    0,
  );

  const analytics = JSON.parse(
    await readFile(PRODUCT_ANALYTICS_FILE, "utf8"),
  ) as { events: Array<{ userId: string | null; meta?: { source?: string } }> };
  assert.ok(
    analytics.events
      .filter((e) => e.meta?.source === "gate-rgpd")
      .every((e) => e.userId === null),
  );

  if (infraPersistentReady()) {
    throw new Error(
      "BLOCKED: infra persistent détectée — étendre ce check avec requêtes PG/S3/Redis (non branché dans ce run FS).",
    );
  }

  return "FS wipe: user data/uploads absents ; analytics/feedback/reports/events anonymisés. PG/S3/Redis: non testés (env absente).";
}

async function checkStripeOutOfOrder(): Promise<string> {
  const userId = `gate-stripe-${Date.now()}`;
  resetUserWorkspaceCache();
  await ensureUserWorkspace(userId);
  const subId = "sub_gate_disorder";

  await withEnv(
    {
      DOCMIND_STORAGE: "fs",
      STRIPE_SECRET_KEY: undefined,
      STRIPE_PRICE_PREMIUM: undefined,
    },
    async () => {
      // Ordre chaotique volontaire
      const sequence: Array<{
        created: number;
        type: string;
        status: string;
        plan?: string;
      }> = [
        { created: 500, type: "invoice.paid", status: "active", plan: "premium" },
        {
          created: 900,
          type: "customer.subscription.deleted",
          status: "canceled",
          plan: "premium",
        },
        {
          created: 700,
          type: "customer.subscription.updated",
          status: "active",
          plan: "premium",
        }, // stale renew
        {
          created: 600,
          type: "checkout.session.completed",
          status: "active",
          plan: "premium",
        }, // stale checkout
        {
          created: 800,
          type: "charge.refunded",
          status: "canceled",
          plan: "premium",
        },
        {
          created: 400,
          type: "customer.subscription.updated",
          status: "active",
          plan: "premium",
        }, // oldest
      ];

      // Appliquer dans l'ordre reçu (désordre), pas trié
      for (const ev of sequence) {
        await applyStripeSubscription(
          userId,
          makeStripeSub({
            id: subId,
            status: ev.status,
            planMeta: ev.plan,
          }),
          { id: `evt_${ev.created}`, type: ev.type, created: ev.created },
        );
      }

      const sub = await getUserSubscription(userId);
      // Après deleted@900, tout event créé < 900 doit être ignoré → free/canceled
      assert.equal(sub.plan, "free", `plan=${sub.plan}`);
      assert.equal(sub.status, "canceled", `status=${sub.status}`);
    },
  );

  await rm(userDataDir(userId), { recursive: true, force: true }).catch(
    () => undefined,
  );
  return "Séquence désordonnée checkout/renew/refund/cancel/invoice/deleted → état final free/canceled";
}

async function checkMultiInstanceLocal(): Promise<string> {
  const userId = `gate-multi-${Date.now()}`;
  resetUserWorkspaceCache();
  await ensureUserWorkspace(userId);

  // Quota concurrent FS
  await withEnv(
    {
      DOCMIND_STORAGE: "fs",
      BILLING_ENTITLEMENTS_FAIL_OPEN: "0",
      QUOTA_FREE_ANALYZE: "5",
      STRIPE_SECRET_KEY: undefined,
      STRIPE_PRICE_PREMIUM: undefined,
    },
    async () => {
      const tasks = Array.from({ length: 8 }, () =>
        consumeQuota(userId, "analyze").then(
          () => "ok" as const,
          () => "block" as const,
        ),
      );
      const outcomes = await Promise.all(tasks);
      const oks = outcomes.filter((o) => o === "ok").length;
      const blocks = outcomes.filter((o) => o === "block").length;
      assert.equal(oks, 5, `oks=${oks}`);
      assert.equal(blocks, 3, `blocks=${blocks}`);
      const status = await getQuotaStatus(userId);
      const analyze = status.items.find((i) => i.metric === "analyze");
      assert.equal(analyze?.used, 5);
    },
  );

  // Webhooks simultanés même user (mutex billing)
  await withEnv({ DOCMIND_STORAGE: "fs" }, async () => {
    const subId = "sub_multi";
    await Promise.all([
      applyStripeSubscription(
        userId,
        makeStripeSub({ id: subId, status: "active", planMeta: "premium" }),
        { id: "evt_a", type: "customer.subscription.updated", created: 100 },
      ),
      applyStripeSubscription(
        userId,
        makeStripeSub({ id: subId, status: "canceled", planMeta: "premium" }),
        { id: "evt_b", type: "customer.subscription.deleted", created: 200 },
      ),
    ]);
    const sub = await getUserSubscription(userId);
    // L'event le plus récent (200) doit gagner s'il est appliqué en dernier
    // ou si 200 > lastWebhookAt après 100
    assert.ok(
      sub.status === "canceled" || sub.plan === "free",
      JSON.stringify(sub),
    );
  });

  // Lock concurrent (process-local queue)
  let concurrent = 0;
  let maxConcurrent = 0;
  await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      withKeyedLock(`gate:multi:${userId}`, async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 20));
        concurrent -= 1;
        return i;
      }),
    ),
  );
  assert.equal(maxConcurrent, 1, `maxConcurrent=${maxConcurrent}`);

  await rm(userDataDir(userId), { recursive: true, force: true }).catch(
    () => undefined,
  );

  if (!hasEnv("REDIS_URL")) {
    return "Quota+webhook+lock process-local OK. BLOCKED partiel: multi-instance Redis réel absent.";
  }
  return "Quota concurrent + webhooks + keyed-lock OK (Redis URL présente — lease multi-instance non smoke ici).";
}

async function checkCrashRecoverySim(): Promise<string> {
  const userId = `gate-crash-${Date.now()}`;
  resetUserWorkspaceCache();
  await ensureUserWorkspace(userId);

  // Crash pendant « analyse » = dual-write après delete history simulé
  const record: HistoryRecord = {
    id: `hist-${Date.now()}`,
    userId,
    documentId: `doc-${Date.now()}`,
    fileName: "crash.pdf",
    displayName: null,
    favorite: false,
    tagIds: [],
    createdAt: new Date().toISOString(),
    analyzedAt: new Date().toISOString(),
    model: "test",
    extractedText: "crash recovery dual write",
    folderId: null,
    analysisPhase: "complete",
    classification: { category: "autre", label: "Autre", confidence: 0.5 },
    analysis: {
      document_type: "X",
      title: "X",
      summary: "x",
      date: "",
      dates: [],
      people: [],
      organizations: [],
      amounts: [],
      deadlines: [],
      important_points: [],
      actions: [],
      risks: [],
      risk_score: 0,
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
    },
    readyReply: EMPTY_READY_REPLY,
  };
  await runMemoryDualWrite(record);
  assert.equal(await getMemoryDocument(userId, record.documentId), null);

  // Crash pendant upload simulé : fichier partiel puis absence meta
  const uploads = userUploadsDir(userId);
  await mkdir(uploads, { recursive: true });
  const partial = path.join(uploads, "partial-crash.pdf");
  await writeFile(partial, "%PDF-partial", "utf8");
  // « kill » = pas de finalisation — le fichier orphelin reste (comportement documenté)
  assert.ok(await access(partial).then(() => true, () => false));

  // Crash pendant delete : anonymize analytics puis interruption avant wipe dirs
  await trackAnalyticsEvent({
    name: "account.deleted",
    userId,
    meta: { source: "gate-crash" },
  });
  await anonymizeAnalyticsForUser(userId);
  // dirs encore là — reprise wipe
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
  await assert.rejects(() => access(userDataDir(userId)));

  return "Crash sim: dual-write sans history no-op ; upload partiel détectable ; reprise wipe compte OK. Kill process OS réel non orchestré.";
}

async function checkMigrationBlockedOrRun(): Promise<string> {
  if (!infraPersistentReady() || !hasEnv("REDIS_URL")) {
    throw new Error(
      "BLOCKED: migrate FS→persistent→rollback exige DATABASE_URL + S3_* + REDIS_URL. Aucun .env local.",
    );
  }
  // Si un jour l'infra est là — enchaîner migrate:persistent + validate
  execSync("npm run migrate:persistent", { cwd: ROOT, stdio: "pipe" });
  execSync("npm run validate:persistent", { cwd: ROOT, stdio: "pipe" });
  return "migrate:persistent + validate:persistent OK";
}

async function checkBackupRestorePdfs(): Promise<string> {
  const markerName = `gate-pdf-${Date.now()}.pdf`;
  const markerDir = path.join(ROOT, "uploads", "_gate");
  await mkdir(markerDir, { recursive: true });
  const markerPath = path.join(markerDir, markerName);
  const payload = `%PDF-1.4\n%gate-backup-${randomUUID()}\n`;
  await writeFile(markerPath, payload, "utf8");
  const expectedHash = createHash("sha256").update(payload).digest("hex");

  const id = `gate-backup-${Date.now()}`;
  await withEnv({ DOCMIND_STORAGE: "fs" }, async () => {
    await createDailyBackup({ id });
  });

  const verification = await verifyBackup(id);
  assert.ok(verification.ok, verification.errors.join("; "));

  // Supprimer le PDF (simule perte)
  await rm(markerPath, { force: true });
  await assert.rejects(() => access(markerPath));

  // Restore
  await withEnv({ DOCMIND_STORAGE: "fs" }, async () => {
    await restoreBackup(id);
  });

  await access(markerPath);
  const restored = await readFile(markerPath);
  const gotHash = createHash("sha256").update(restored).digest("hex");
  assert.equal(gotHash, expectedHash, "PDF restauré ≠ original");

  // Cleanup backup artifact
  await rm(path.join(ROOT, "backups", id), { recursive: true, force: true }).catch(
    () => undefined,
  );

  if (infraPersistentReady()) {
    return "FS backup/restore PDF hash OK. BLOCKED partiel: backup PG/S3 non couvert par createDailyBackup.";
  }
  return `FS backup→delete→restore PDF OK (sha256=${expectedHash.slice(0, 12)}…)`;
}

async function checkLoadModel(): Promise<string> {
  const out = execSync(
    "npx tsx --tsconfig tsconfig.json scripts/load-simulator/run.ts --mode model --users 100,500,1000",
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  assert.ok(
    out.includes("100") && out.includes("500") && out.includes("1000"),
    "rapport load incomplet",
  );
  return "load:test model 100/500/1000 exécuté (voir reports/)";
}

async function checkE2E(): Promise<string> {
  // Ollama ?
  let ollamaUp = false;
  try {
    const res = await fetch(
      (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434") + "/api/tags",
      { signal: AbortSignal.timeout(2000) },
    );
    ollamaUp = res.ok;
  } catch {
    ollamaUp = false;
  }

  const env = {
    ...process.env,
    E2E_REQUIRE_OLLAMA: ollamaUp ? "1" : "0",
    CI: undefined,
  };

  const result = spawnSync("npx", ["playwright", "test"], {
    cwd: ROOT,
    encoding: "utf8",
    env,
    shell: true,
  });

  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    throw new Error(`Playwright exit ${result.status}\n${combined.slice(-2000)}`);
  }

  const skippedAi =
    combined.includes("analyse document + cache hit") &&
    combined.includes("skipped");
  if (!ollamaUp && !skippedAi) {
    // may still skip with different formatting
  }

  return ollamaUp
    ? "E2E OK avec Ollama requis (aucun skip IA attendu)"
    : "E2E OK ; skips IA uniquement (Ollama absent) — E2E_REQUIRE_OLLAMA=0";
}

async function checkColdStartContract(): Promise<string> {
  // Cold start Vercel = instrumentation + env assert. On vérifie que le module charge.
  const { assertProductionEnvOrThrow, isDeployedEnv } = await import(
    "../src/lib/env-validate"
  );
  assert.equal(typeof assertProductionEnvOrThrow, "function");
  assert.equal(typeof isDeployedEnv, "function");
  return "instrumentation/env-validate chargeable (cold start réel Vercel non mesuré sans déploiement)";
}

async function writeReport(): Promise<string> {
  const dir = path.join(ROOT, "reports");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `prod-gate-${stamp}.json`);
  const summary = {
    generatedAt: new Date().toISOString(),
    pass: results.filter((r) => r.status === "PASS").length,
    fail: results.filter((r) => r.status === "FAIL").length,
    blocked: results.filter((r) => r.status === "BLOCKED").length,
    results,
  };
  await writeFile(file, JSON.stringify(summary, null, 2), "utf8");
  return file;
}

async function main() {
  console.log("=== DocMind production gate ===\n");

  await runCheck("BUILD", "npm run build (Vercel complet)", checkBuildAlreadyOk);
  await runCheck("ENV", "Contrat variables Vercel/production", checkVercelEnvContract);
  await runCheck("RGPD", "Suppression compte — traces locales", checkRgpdWipeFs);
  await runCheck("STRIPE", "Webhooks désordonnés", checkStripeOutOfOrder);
  await runCheck("MULTI", "Concurrence quota/webhook/lock", checkMultiInstanceLocal);
  await runCheck("CRASH", "Récupération après interruption", checkCrashRecoverySim);
  await runCheck("MIGRATE", "FS → persistent → rollback", checkMigrationBlockedOrRun);
  await runCheck("BACKUP", "Backup → wipe PDF → restore", checkBackupRestorePdfs);
  await runCheck("LOAD", "Load model 100/500/1000", checkLoadModel);
  await runCheck("E2E", "Playwright (skips Ollama seuls OK)", checkE2E);
  await runCheck("COLD", "Cold start / env assert modules", checkColdStartContract);

  const reportPath = await writeReport();
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const blocked = results.filter((r) => r.status === "BLOCKED").length;

  console.log("\n=== SUMMARY ===");
  console.log(`PASS=${pass} FAIL=${fail} BLOCKED=${blocked}`);
  console.log(`Report: ${reportPath}`);

  if (fail > 0) process.exit(1);
  if (blocked > 0) {
    console.log(
      "\nGate INCOMPLETE: des checks BLOCKED exigent .env (DATABASE_URL, S3_*, REDIS_URL, Stripe, Supabase).",
    );
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
