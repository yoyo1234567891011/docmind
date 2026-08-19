/**
 * Vérifie les services Admin en mode prod simulé (sans écriture FS).
 * Usage: node scripts/verify-admin.mjs
 */
import { readFileSync } from "fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 0) continue;
  const k = t.slice(0, i).trim();
  const v = t.slice(i + 1).trim();
  if (!process.env[k]) process.env[k] = v;
}

// Simule Vercel prod
process.env.VERCEL = "1";
process.env.DOCMIND_STORAGE = "persistent";
process.env.NODE_ENV = "production";

const results = [];

function ok(name, detail = "") {
  results.push({ name, status: "OK", detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, err) {
  const msg = err instanceof Error ? err.message : String(err);
  results.push({ name, status: "FAIL", detail: msg });
  console.error(`✗ ${name} — ${msg}`);
}

// 1. Metrics store (ne doit pas throw)
try {
  const { readAdminMetrics, summarizePerformance } = await import(
    "../src/services/admin/metrics-store.ts"
  );
  const m = await readAdminMetrics();
  const perf = summarizePerformance(m.events);
  ok("readAdminMetrics (prod simulé)", `${m.events.length} events, ${perf.totalCalls} calls`);
} catch (e) {
  fail("readAdminMetrics", e);
}

// 2. Analytics store
try {
  const { readAnalyticsFile } = await import("../src/services/analytics/store.ts");
  const a = await readAnalyticsFile();
  ok("readAnalyticsFile (prod simulé)", `${a.events.length} events`);
} catch (e) {
  fail("readAnalyticsFile", e);
}

// 3. Admin config + prompts
try {
  const { readAdminConfig, readAdminPrompts } = await import("../src/services/admin/index.ts");
  const cfg = await readAdminConfig();
  const prompts = await readAdminPrompts();
  ok("readAdminConfig", `model=${cfg.tasks.analyze.model}`);
  ok("readAdminPrompts", `${prompts.versions.length} versions`);
} catch (e) {
  fail("readAdminConfig/prompts", e);
}

// 4. Platform overview (DB)
try {
  const { buildAdminPlatformOverview } = await import(
    "../src/services/admin/platform-stats.ts"
  );
  const o = await buildAdminPlatformOverview();
  ok(
    "buildAdminPlatformOverview",
    `users=${o.users.totalEver}, jobs=${o.analyses.completed}/${o.analyses.total}, model=${o.llm.model}`,
  );
} catch (e) {
  fail("buildAdminPlatformOverview", e);
}

// 5. Production dashboard
try {
  const { buildProductionDashboard } = await import(
    "../src/services/ops/production-dashboard.ts"
  );
  const d = await buildProductionDashboard();
  ok(
    "buildProductionDashboard",
    `analyses24h=${d.throughput.analyses24h}, stripe=${d.stripe.status}`,
  );
} catch (e) {
  fail("buildProductionDashboard", e);
}

// 6. Monitoring check (prod simulé)
try {
  const { runMonitoringCheck } = await import("../src/services/monitoring/collect.ts");
  const check = await runMonitoringCheck();
  ok(
    "runMonitoringCheck",
    `llm=${check.snapshot.workers.ollamaUp ? "up" : "down"}, alerts=${check.newAlerts.length}`,
  );
} catch (e) {
  fail("runMonitoringCheck", e);
}

// 7. Monitoring (lecture seule)
try {
  const { listMonitoringAlerts, readMonitoringSnapshot } = await import(
    "../src/services/monitoring/store.ts"
  );
  const alerts = await listMonitoringAlerts();
  const snap = await readMonitoringSnapshot();
  ok("monitoring store", `${alerts.length} alertes, snapshot=${snap ? "oui" : "non"}`);
} catch (e) {
  fail("monitoring store", e);
}

// 8. LLM provider
try {
  const { getLlmProviderConfig } = await import("../src/ai/models/llm-provider.ts");
  const llm = getLlmProviderConfig();
  ok(
    "getLlmProviderConfig",
    llm.kind === "openai_compatible"
      ? `${llm.model} @ ${llm.baseUrl.slice(0, 40)}`
      : "ollama",
  );
} catch (e) {
  fail("getLlmProviderConfig", e);
}

// 9. ADMIN_EMAILS
const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim())
  .filter(Boolean);
if (adminEmails.includes("yoyo270709@gmail.com")) {
  ok("ADMIN_EMAILS", adminEmails.join(", "));
} else {
  fail("ADMIN_EMAILS", `yoyo270709@gmail.com absent: ${adminEmails.join(", ") || "(vide)"}`);
}

console.log("\n--- Résumé ---");
const fails = results.filter((r) => r.status === "FAIL");
console.log(`${results.length - fails.length}/${results.length} OK`);
if (fails.length > 0) process.exit(1);
