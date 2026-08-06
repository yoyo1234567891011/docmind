import assert from "assert";
import { randomUUID } from "crypto";

import { fetchOllama } from "../../src/ai/models/ollama-http";
import { query } from "../../src/lib/db/pool";
import { AppError } from "../../src/lib/errors";
import { checkRateLimitAsync } from "../../src/lib/rate-limit";
import { getStripe, getStripeAsync } from "../../src/lib/stripe";
import { putPdfObject } from "../../src/lib/storage/s3";
import { upsertSubscriptionPatch } from "../../src/services/billing/store";
import {
  getHistoryRecord,
  saveHistoryRecord,
  updateHistoryRecord,
} from "../../src/services/history/store";
import { savePdfToUploads } from "../../src/services/storage";

import {
  buildChaosAnalysisResult,
  chaosDocumentId,
  chaosUserId,
} from "../fixtures";
import {
  assertUserDataIntact,
  countUserHistory,
  expectFailure,
  isAppErrorCode,
  runWithFault,
  seedDurableUserData,
  type ChaosScenario,
} from "../harness";

async function withTempEnv(
  env: Record<string, string>,
  fn: () => Promise<void>,
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    process.env[k] = v;
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

export const scenarios: ChaosScenario[] = [
  {
    id: "ollama_down",
    title: "Ollama down — données utilisateur intactes",
    async run() {
      const seed = await seedDurableUserData("ollama");
      await runWithFault("ollama_down", async () => {
        await expectFailure(
          () => fetchOllama("http://127.0.0.1:11434", "/api/tags"),
          (e) => isAppErrorCode(e, "OLLAMA_UNAVAILABLE"),
        );
      });
      await assertUserDataIntact(seed);
      return "OLLAMA_UNAVAILABLE; PDF+historique conservés";
    },
  },
  {
    id: "redis_down",
    title: "Redis down — fail-closed déployé, données intactes",
    async run() {
      const seed = await seedDurableUserData("redis");
      await withTempEnv(
        {
          REDIS_URL: "redis://127.0.0.1:6399",
          NEXT_PUBLIC_APP_ENV: "staging",
        },
        async () => {
          await runWithFault("redis_down", async () => {
            const limited = await checkRateLimitAsync({
              key: `chaos-redis:${seed.userId}`,
              limit: 10,
              windowMs: 60_000,
            });
            assert.equal(limited.ok, false, "fail-closed attendu en staging");
          });
        },
      );
      await assertUserDataIntact(seed);
      return "rate-limit fail-closed; aucune perte de données";
    },
  },
  {
    id: "postgres_down",
    title: "Postgres down — lecture FS locale intacte",
    async run() {
      const seed = await seedDurableUserData("postgres");
      await runWithFault("postgres_down", async () => {
        await expectFailure(
          () => query("select 1"),
          /Postgres|chaos/i,
        );
      });
      // En mode FS, l’historique ne dépend pas de Postgres.
      await assertUserDataIntact(seed);
      return "query PG échoue; données FS utilisateur intactes";
    },
  },
  {
    id: "s3_down",
    title: "S3 down — upload refusé, historique existant intact",
    async run() {
      const seed = await seedDurableUserData("s3");
      const before = await countUserHistory(seed.userId);
      await withTempEnv(
        {
          DOCMIND_STORAGE: "persistent",
          DATABASE_URL: process.env.DATABASE_URL || "postgres://invalid",
          S3_BUCKET: "chaos-bucket",
          S3_ACCESS_KEY_ID: "chaos",
          S3_SECRET_ACCESS_KEY: "chaos",
          S3_ENDPOINT: "http://127.0.0.1:19000",
        },
        async () => {
          await runWithFault("s3_down", async () => {
            await expectFailure(
              () =>
                putPdfObject(seed.userId, chaosDocumentId(), Buffer.from("%PDF")),
              (e) =>
                isAppErrorCode(e, "INTERNAL_ERROR") ||
                /chaos|Storage|S3/i.test(String(e)),
            );
          });
        },
      );
      // Revenir en FS pour l’assert
      process.env.DOCMIND_STORAGE = "fs";
      await assertUserDataIntact(seed);
      assert.equal(await countUserHistory(seed.userId), before);
      return "put S3 échoue; historique existant non modifié";
    },
  },
  {
    id: "stripe_timeout",
    title: "Stripe timeout — abonnement local non corrompu",
    async run() {
      const seed = await seedDurableUserData("stripe");
      await upsertSubscriptionPatch(seed.userId, {
        plan: "free",
        status: "canceled",
      });
      await runWithFault("stripe_timeout", async () => {
        await expectFailure(
          () => getStripeAsync(),
          (e) => isAppErrorCode(e, "BAD_REQUEST") || /timeout|chaos/i.test(String(e)),
        );
        await expectFailure(
          async () => getStripe(),
          (e) => isAppErrorCode(e, "BAD_REQUEST") || /timeout|chaos/i.test(String(e)),
        );
      });
      const { getUserSubscription } = await import(
        "../../src/services/billing/store"
      );
      const sub = await getUserSubscription(seed.userId);
      assert.equal(sub.plan, "free");
      await assertUserDataIntact(seed);
      return "Stripe timeout; plan local inchangé";
    },
  },
  {
    id: "webhook_lost",
    title: "Webhook perdu puis rejoué — pas de double corruption",
    async run() {
      const seed = await seedDurableUserData("webhook");
      const eventId = `evt_chaos_${randomUUID()}`;
      // 1) Livraison « perdue » : aucun effet
      // 2) Retry Stripe
      await upsertSubscriptionPatch(seed.userId, {
        plan: "premium",
        status: "active",
        lastWebhookEventId: eventId,
        lastWebhookEventType: "customer.subscription.updated",
        lastWebhookAt: new Date().toISOString(),
      });
      // 3) Duplicate retry — upsert idempotent
      await upsertSubscriptionPatch(seed.userId, {
        plan: "premium",
        status: "active",
        lastWebhookEventId: eventId,
        lastWebhookEventType: "customer.subscription.updated",
        lastWebhookAt: new Date().toISOString(),
      });
      const { getUserSubscription } = await import(
        "../../src/services/billing/store"
      );
      const sub = await getUserSubscription(seed.userId);
      assert.equal(sub.plan, "premium");
      assert.equal(sub.lastWebhookEventId, eventId);
      await assertUserDataIntact(seed);
      return "retry webhook idempotent; docs utilisateur intacts";
    },
  },
  {
    id: "disk_full",
    title: "Disque plein — écriture refusée, données existantes intactes",
    async run() {
      const seed = await seedDurableUserData("disk");
      const before = await countUserHistory(seed.userId);
      await runWithFault("disk_full", async () => {
        await expectFailure(
          () =>
            savePdfToUploads(
              seed.userId,
              chaosDocumentId(),
              Buffer.from("%PDF-1.4 chaos"),
            ),
          (e) =>
            (e instanceof AppError && e.code === "UPLOAD_FAILED") ||
            /ENOSPC|no space|chaos/i.test(String(e)),
        );
        await expectFailure(
          () =>
            saveHistoryRecord(seed.userId, {
              fileName: "should-fail.pdf",
              extractedText: "fail",
              result: buildChaosAnalysisResult(chaosDocumentId(), "complete"),
            }),
          /ENOSPC|no space|mémoire|historique|chaos|INTERNAL/i,
        );
      });
      await assertUserDataIntact(seed);
      assert.equal(await countUserHistory(seed.userId), before);
      return "ENOSPC simulé; seed utilisateur intact";
    },
  },
  {
    id: "memory_saturated",
    title: "Mémoire saturée — pas d’écrasement d’historique",
    async run() {
      const seed = await seedDurableUserData("oom");
      const before = await countUserHistory(seed.userId);
      await runWithFault("memory_saturated", async () => {
        await expectFailure(
          () =>
            saveHistoryRecord(seed.userId, {
              fileName: "oom.pdf",
              extractedText: "oom",
              result: buildChaosAnalysisResult(chaosDocumentId(), "complete"),
            }),
          /heap|out of memory|historique|INTERNAL|chaos/i,
        );
      });
      await assertUserDataIntact(seed);
      assert.equal(await countUserHistory(seed.userId), before);
      return "OOM simulé; historique seed intact";
    },
  },
  {
    id: "upload_interrupted",
    title: "Upload interrompu — aucun historique fantôme",
    async run() {
      const seed = await seedDurableUserData("upload");
      const before = await countUserHistory(seed.userId);
      const orphanId = chaosDocumentId();
      await runWithFault("upload_interrupted", async () => {
        await expectFailure(
          () =>
            savePdfToUploads(seed.userId, orphanId, Buffer.from("%PDF-1.4 x")),
          (e) =>
            (e instanceof AppError &&
              (e.code === "BAD_REQUEST" || e.code === "UPLOAD_FAILED")) ||
            /interrompu|chaos/i.test(String(e)),
        );
      });
      await assertUserDataIntact(seed);
      assert.equal(await countUserHistory(seed.userId), before);
      return "upload aborté avant persistance utile; pas de ghost history";
    },
  },
  {
    id: "connection_cut",
    title: "Connexion coupée mid-analyse — seed durable",
    async run() {
      const seed = await seedDurableUserData("conn");
      await runWithFault("connection_cut", async () => {
        const { chaosGate } = await import("../../src/lib/chaos");
        await expectFailure(
          () => chaosGate("connection_cut"),
          (e) =>
            (e instanceof Error && e.name === "AbortError") ||
            /abort/i.test(String(e)),
        );
      });
      await assertUserDataIntact(seed);
      return "AbortError; PDF+preview conservés";
    },
  },
  {
    id: "gpu_crash",
    title: "Worker GPU (Ollama) crash — données utilisateur intactes",
    async run() {
      const seed = await seedDurableUserData("gpu");
      await runWithFault("gpu_crash", async () => {
        await expectFailure(
          () => fetchOllama("http://127.0.0.1:11434", "/api/generate", {
            method: "POST",
            body: "{}",
          }),
          /ECONNRESET|OLLAMA|chaos|fetch|réseau/i,
        );
      });
      await assertUserDataIntact(seed);
      return "ECONNRESET GPU; historique preview intact";
    },
  },
  {
    id: "server_restart",
    title: "Redémarrage serveur pendant analyse — preview durable",
    async run() {
      const userId = chaosUserId("restart");
      const { ensureUserWorkspace, resetUserWorkspaceCache } = await import(
        "../../src/services/auth/workspace"
      );
      await ensureUserWorkspace(userId);
      const documentId = chaosDocumentId();
      await savePdfToUploads(
        userId,
        documentId,
        Buffer.from("%PDF-1.4\n%%EOF\nrestart", "utf8"),
      );
      // P1 preview persisté (comme progressive mode avant after())
      const preview = await saveHistoryRecord(userId, {
        fileName: "restart.pdf",
        extractedText: "analyse interrompue par restart",
        result: buildChaosAnalysisResult(documentId, "preview"),
      });
      assert.equal(preview.analysisPhase, "preview");

      // Simule crash process : vider caches mémoire, recharger depuis disque
      resetUserWorkspaceCache();
      const { clearChaosFaults } = await import("../../src/lib/chaos");
      clearChaosFaults();

      const reloaded = await getHistoryRecord(userId, preview.id);
      assert.equal(reloaded.id, preview.id);
      assert.equal(reloaded.analysisPhase, "preview");
      assert.equal(
        reloaded.analysis.summary,
        preview.analysis.summary,
        "preview ne doit pas être perdu au restart",
      );

      // Après restart, P2 peut marquer failed sans perdre le preview content
      await updateHistoryRecord(userId, preview.id, {
        analysisPhase: "failed",
      });
      const afterFail = await getHistoryRecord(userId, preview.id);
      assert.equal(afterFail.analysisPhase, "failed");
      assert.equal(afterFail.analysis.summary, preview.analysis.summary);
      assert.equal(afterFail.documentId, documentId);

      await assertUserDataIntact({
        userId,
        documentId,
        historyId: preview.id,
        summary: preview.analysis.summary,
      });
      return "preview survit au restart; PDF intact; phase failed sans perte";
    },
  },
];
