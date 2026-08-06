import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { estimateAnalysisCostEur } from "../src/config/analytics";
import { sanitizeAnalyticsPathname } from "../src/lib/analytics-pathname";
import { summarizeProductAnalytics } from "../src/services/analytics/summarize";
import {
  ANALYTICS_EVENT_NAMES,
  CLIENT_ANALYTICS_EVENT_NAMES,
  type AnalyticsEvent,
} from "../src/types/analytics";

function event(
  name: AnalyticsEvent["name"],
  meta?: AnalyticsEvent["meta"],
  hoursAgo = 1,
): AnalyticsEvent {
  return {
    id: crypto.randomUUID(),
    at: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
    name,
    userId: "u1",
    meta,
  };
}

async function testIdempotency() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "docmind-analytics-"));
  const prevCwd = process.cwd();
  try {
    process.chdir(dir);
    const { trackAnalyticsEvent, readAnalyticsFile } = await import(
      "../src/services/analytics/store"
    );

    const first = await trackAnalyticsEvent({
      name: "billing.renewed",
      userId: "u1",
      idempotencyKey: "billing.renewed:in_test_1",
      meta: { plan: "premium", source: "test" },
    });
    const second = await trackAnalyticsEvent({
      name: "billing.renewed",
      userId: "u1",
      idempotencyKey: "billing.renewed:in_test_1",
      meta: { plan: "premium", source: "test" },
    });
    assert.equal(first.recorded, true);
    assert.equal(second.recorded, false);

    const file = await readAnalyticsFile();
    const renewed = file.events.filter((e) => e.name === "billing.renewed");
    assert.equal(renewed.length, 1);
  } finally {
    process.chdir(prevCwd);
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  const required = [
    "page.view",
    "auth.signup",
    "auth.login",
    "billing.renewed",
    "account.deleted",
    "account.exported",
    "billing.refunded",
    "billing.cancel_requested",
  ] as const;
  for (const name of required) {
    assert.ok(
      (ANALYTICS_EVENT_NAMES as readonly string[]).includes(name),
      `missing event in catalog: ${name}`,
    );
  }
  assert.ok(CLIENT_ANALYTICS_EVENT_NAMES.includes("page.view"));
  assert.ok(CLIENT_ANALYTICS_EVENT_NAMES.includes("auth.signup"));
  assert.ok(CLIENT_ANALYTICS_EVENT_NAMES.includes("auth.login"));

  assert.equal(
    sanitizeAnalyticsPathname("/historique/abc-def-123456789012345678?x=1"),
    "/historique/:id",
  );
  assert.equal(sanitizeAnalyticsPathname("dashboard"), "/dashboard");

  const events: AnalyticsEvent[] = [
    event("page.view", { pathname: "/dashboard", source: "app_router" }),
    event("auth.signup", { provider: "password", source: "signup_form" }),
    event("auth.login", { provider: "password", source: "login_form" }),
    event("analysis.started", { documentId: "d1" }),
    event("analysis.p1", { durationMs: 120, documentType: "Bail" }),
    event("analysis.p2", {
      durationMs: 90_000,
      documentType: "Bail",
      totalTokens: 2000,
      estimatedCostEur: 0.003,
    }),
    event("analysis.completed", {
      durationMs: 90_120,
      documentType: "Bail",
      estimatedCostEur: 0.003,
    }),
    event("analysis.fallback", { documentType: "Bail" }),
    event("analysis.abandon", { reason: "poll_timeout" }),
    event("extraction.completed", {
      durationMs: 400,
      ocrDurationMs: 0,
      method: "unpdf",
    }),
    event("satisfaction.rated", { rating: 5 }),
    event("satisfaction.rated", { rating: 4 }),
    event("billing.checkout_started", { plan: "premium" }),
    event("billing.converted", { plan: "premium" }),
    event("billing.renewed", {
      plan: "premium",
      billingReason: "subscription_cycle",
    }),
    event("billing.cancel_requested", { plan: "premium", mode: "period_end" }),
    event("billing.refunded", { full: true, reason: "full_refund" }),
    event("billing.churned", { plan: "free", reason: "full_refund" }),
    event("account.exported", { entryCount: 12, bytes: 4096 }),
    event("account.deleted", { authDeleted: true }),
    event("analysis.error", {
      phase: "p2",
      message: "timeout",
      errorCode: "TIMEOUT",
    }),
    event("analysis.started", { documentId: "d2" }, 48),
    event("analysis.p2", {
      durationMs: 60_000,
      documentType: "Facture",
    }),
  ];

  const summary = summarizeProductAnalytics(events, { windowDays: 1 });
  assert.equal(summary.analysesStarted, 1);
  assert.equal(summary.analysesCompleted, 1);
  assert.equal(summary.fallbackCount, 1);
  assert.ok(summary.fallbackRate > 0);
  assert.equal(summary.abandonCount, 1);
  assert.equal(summary.pageViews, 1);
  assert.equal(summary.signups, 1);
  assert.equal(summary.logins, 1);
  assert.equal(summary.p1.avgMs, 120);
  assert.ok(summary.p2.count >= 1);
  assert.equal(summary.ocr.avgMs, 0);
  assert.equal(summary.satisfaction.average, 4.5);
  assert.equal(summary.conversion.converted, 1);
  assert.equal(summary.conversion.renewed, 1);
  assert.equal(summary.conversion.cancelRequested, 1);
  assert.equal(summary.conversion.refunded, 1);
  assert.equal(summary.conversion.churned, 1);
  assert.equal(summary.conversion.freeToPremiumRate, 1);
  assert.equal(summary.account.deleted, 1);
  assert.equal(summary.account.exported, 1);
  assert.ok(summary.topDocumentTypes[0]?.label === "Bail");
  assert.ok(summary.cost.avgPerAnalysisEur > 0);
  assert.equal(summary.analysesErrored, 1);

  const cost = estimateAnalysisCostEur({
    durationMs: 3_600_000,
    totalTokens: 0,
  });
  assert.ok(cost > 0);

  await testIdempotency();

  console.log("OK test-analytics", {
    catalogSize: ANALYTICS_EVENT_NAMES.length,
    p1: summary.p1.avgMs,
    renewed: summary.conversion.renewed,
    pageViews: summary.pageViews,
    accountDeleted: summary.account.deleted,
    cost: summary.cost.avgPerAnalysisEur,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
