/**
 * Tests des 5 points audit prod : export, backup, cache versionné, quotas, monitoring.
 */
import assert from "assert";
import { mkdir, writeFile, rm } from "fs/promises";
import path from "path";

import {
  ANALYSIS_PIPELINE_VERSION,
  buildCacheFingerprint,
  buildCacheKey,
  getCachedAnalysis,
  setCachedAnalysis,
} from "../src/ai/optimizations/analysis-cache";
import { buildZipBuffer } from "../src/lib/zip";
import { AppError } from "../src/lib/errors";
import { buildUserDataExportZip } from "../src/services/account/export-account";
import {
  createDailyBackup,
  restoreBackup,
  verifyBackup,
} from "../src/services/backup/backup";
import { ensureUserWorkspace, resetUserWorkspaceCache } from "../src/services/auth/workspace";
import { runMonitoringCheck } from "../src/services/monitoring/collect";
import { appendMonitoringEvent } from "../src/services/monitoring/store";
import { consumeQuota, getQuotaStatus } from "../src/services/quotas/enforce";
import { EMPTY_READY_REPLY } from "../src/types/reply";

async function withEnv(
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

async function testCacheVersioning() {
  process.env.OPT_ANALYSIS_CACHE = "1";
  const userId = `ops-cache-${Date.now()}`;
  await ensureUserWorkspace(userId);
  const text = `cache-version-${Date.now()}`;
  const promptsA = [
    {
      key: "analysis" as const,
      source: "code" as const,
      version: 1,
      versionId: null,
      label: "code-v1",
    },
  ];
  const fpA = buildCacheFingerprint({
    model: "mistral",
    promptsUsed: promptsA,
  });
  const fpB = buildCacheFingerprint({
    model: "qwen3",
    promptsUsed: promptsA,
  });
  const fpC = buildCacheFingerprint({
    model: "mistral",
    promptsUsed: [
      {
        key: "analysis" as const,
        source: "admin" as const,
        version: 2,
        versionId: "v2",
        label: "admin-v2",
      },
    ],
  });
  const fpD = buildCacheFingerprint({
    model: "mistral",
    promptsUsed: promptsA,
    pipelineVersion: "analyze-pipeline-v999",
  });

  assert.notEqual(buildCacheKey(text, fpA), buildCacheKey(text, fpB));
  assert.notEqual(buildCacheKey(text, fpA), buildCacheKey(text, fpC));
  assert.notEqual(buildCacheKey(text, fpA), buildCacheKey(text, fpD));
  assert.equal(fpA.pipelineVersion, ANALYSIS_PIPELINE_VERSION);

  await setCachedAnalysis({
    userId,
    text,
    fingerprint: fpA,
    model: "mistral",
    classification: { category: "autre", label: "Autre", confidence: 0.5 },
    analysis: {
      document_type: "X",
      title: "Cache",
      summary: "ok",
      date: "",
      dates: [],
      people: [],
      organizations: [],
      amounts: [],
      deadlines: [],
      important_points: [],
      risks: [],
      actions: [],
      risk_score: 0,
      risk_level: "faible",
      risk_explanation: "",
      risk_criteria: [],
    },
    readyReply: EMPTY_READY_REPLY,
  });

  assert.ok(await getCachedAnalysis(userId, text, fpA), "hit même fingerprint");
  assert.equal(
    await getCachedAnalysis(userId, text, fpB),
    null,
    "miss si modèle change",
  );
  assert.equal(
    await getCachedAnalysis(userId, text, fpC),
    null,
    "miss si prompts changent",
  );
  assert.equal(
    await getCachedAnalysis(userId, text, fpD),
    null,
    "miss si pipeline change",
  );
  console.log("✓ cache versioning");
}

async function testQuotas() {
  await withEnv(
    {
      BILLING_ENTITLEMENTS_FAIL_OPEN: "0",
      QUOTA_FREE_ANALYZE: "2",
      QUOTA_FREE_UPLOAD: "5",
      QUOTA_FREE_LETTER: "0",
      QUOTA_FREE_SEARCH: "10",
    },
    async () => {
      const userId = `ops-quota-${Date.now()}`;
      await ensureUserWorkspace(userId);
      await consumeQuota(userId, "analyze");
      await consumeQuota(userId, "analyze");
      let blocked = false;
      try {
        await consumeQuota(userId, "analyze");
      } catch (error) {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "QUOTA_EXCEEDED");
        blocked = true;
      }
      assert.ok(blocked, "3e analyse Free doit être bloquée");
      const status = await getQuotaStatus(userId);
      assert.equal(status.plan, "free");
      const analyze = status.items.find((i) => i.metric === "analyze");
      assert.equal(analyze?.used, 2);
      assert.equal(analyze?.limit, 2);
      console.log("✓ quotas mensuels");
    },
  );
}

async function testBackup() {
  const id = `ops-backup-${Date.now()}`;
  const markerDir = path.join(process.cwd(), "data", "system");
  await mkdir(markerDir, { recursive: true });
  const marker = path.join(markerDir, `ops-backup-marker-${Date.now()}.txt`);
  await writeFile(marker, "backup-ok", "utf8");

  const manifest = await createDailyBackup({ id });
  assert.ok(manifest.files.length > 0);
  const verify = await verifyBackup(id);
  assert.ok(verify.ok, verify.errors.join("; "));
  const dry = await restoreBackup(id, { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.ok(dry.restored > 0);

  await rm(path.join(process.cwd(), "backups", id), {
    recursive: true,
    force: true,
  }).catch(() => undefined);
  await rm(marker).catch(() => undefined);
  console.log("✓ backup + verify + restore dry-run");
}

async function testExportZip() {
  const userId = `ops-export-${Date.now()}`;
  await ensureUserWorkspace(userId);
  const { buffer, fileName, entryCount } = await buildUserDataExportZip(userId);
  assert.ok(buffer.byteLength > 40, "ZIP non vide");
  assert.ok(fileName.endsWith(".zip"));
  assert.ok(entryCount >= 8, "manifest + settings minimum");
  // signature ZIP
  assert.equal(buffer[0], 0x50);
  assert.equal(buffer[1], 0x4b);

  const sample = await buildZipBuffer([
    { path: "hello.txt", data: "hi" },
  ]);
  assert.ok(sample.byteLength > 20);
  console.log("✓ export ZIP RGPD");
}

async function testMonitoring() {
  await appendMonitoringEvent({
    name: "analysis.ok",
    meta: { durationMs: 1200 },
  });
  await appendMonitoringEvent({
    name: "queue.wait",
    meta: { waitMs: 50 },
  });
  await appendMonitoringEvent({
    name: "server.error",
    meta: { status: 500, message: "test" },
  });
  const result = await runMonitoringCheck();
  assert.ok(result.snapshot);
  assert.ok(typeof result.snapshot.analysis.successRate === "number");
  assert.ok(result.snapshot.serverErrors24h >= 1);
  assert.ok("gpu" in result.snapshot);
  assert.ok("workers" in result.snapshot);
  console.log("✓ monitoring snapshot");
}

async function main() {
  resetUserWorkspaceCache();
  await testCacheVersioning();
  await testQuotas();
  await testBackup();
  await testExportZip();
  await testMonitoring();
  console.log("\nTous les tests production-ops OK.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
