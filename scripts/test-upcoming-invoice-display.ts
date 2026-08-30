/**
 * Tests unitaires — règle B (prélèvement immédiat au changement de plan).
 * Usage: npx tsx scripts/test-upcoming-invoice-display.ts
 */
import assert from "node:assert/strict";

import { getBillingPlan } from "../src/config/billing";
import {
  describePlanChangeMessage,
  describePlanChangePreview,
  describeUpcomingInvoice,
} from "../src/lib/billing/upcoming-display";
import { summarizeInvoiceLines } from "../src/services/billing/upcoming-invoice";
import type {
  BillingImmediateInvoice,
  BillingPlanChangePreview,
  BillingUpcomingInvoice,
  UserSubscriptionRecord,
} from "../src/types/billing";

function baseSub(
  overrides: Partial<UserSubscriptionRecord> = {},
): UserSubscriptionRecord {
  const now = new Date().toISOString();
  return {
    userId: "u1",
    plan: "extra",
    status: "active",
    stripeCustomerId: "cus_x",
    stripeSubscriptionId: "sub_x",
    stripePriceId: "price_x",
    currentPeriodStart: now,
    currentPeriodEnd: "2026-09-29T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    canceledAt: null,
    lastWebhookEventId: null,
    lastWebhookEventType: null,
    lastWebhookAt: null,
    updatedAt: now,
    createdAt: now,
    ...overrides,
  };
}

function upcoming(
  overrides: Partial<BillingUpcomingInvoice> = {},
): BillingUpcomingInvoice {
  return {
    status: "available",
    billingDate: "2026-09-29T00:00:00.000Z",
    amountDue: 59.99,
    currency: "EUR",
    isEstimate: true,
    hasProration: false,
    prorationAmount: null,
    recurringAmount: 59.99,
    note: null,
    ...overrides,
  };
}

function previewProToExtra(): BillingPlanChangePreview {
  return {
    currentPlan: "pro",
    targetPlan: "extra",
    currentPlanName: "Pro",
    targetPlanName: "Extra",
    currentMonthlyEur: 19.99,
    targetMonthlyEur: 59.99,
    immediateAmountDue: 29.99,
    currency: "EUR",
    isUpgrade: true,
    nextBillingDate: "2026-09-29T00:00:00.000Z",
    nextMonthlyEur: 59.99,
    available: true,
    note: null,
  };
}

// summarizeInvoiceLines
{
  const summary = summarizeInvoiceLines([
    { amount: 2999, proration: true },
    { amount: 5999, proration: false },
  ]);
  assert.equal(summary.hasProration, true);
  assert.equal(summary.prorationAmount, 29.99);
  assert.equal(summary.recurringAmount, 59.99);
}

// Aperçu avant Pro → Extra
{
  const lines = describePlanChangePreview(previewProToExtra());
  assert.ok(lines.some((l) => l.includes("prélèvement immédiat")));
  assert.ok(lines.some((l) => l.includes("29,99")));
  assert.ok(lines.some((l) => l.includes("59,99")));
  assert.ok(lines.some((l) => l.includes("plan actuel reste inchangé")));
}

// Message après changement réussi
{
  const immediate: BillingImmediateInvoice = {
    id: "in_1",
    number: "ABC-001",
    status: "paid",
    amountDue: 29.99,
    amountPaid: 29.99,
    currency: "EUR",
    createdAt: new Date().toISOString(),
    hostedInvoiceUrl: "https://stripe.test/invoice",
  };
  const msg = describePlanChangeMessage({
    planName: "Extra",
    targetMonthlyEur: 59.99,
    immediateInvoice: immediate,
    upcoming: upcoming(),
    subscription: baseSub({ plan: "extra" }),
  });
  assert.ok(msg.includes("Extra activé"));
  assert.ok(msg.includes("29,99"));
  assert.ok(msg.includes("prélevé"));
  assert.ok(msg.includes("59,99"));
}

// Prochaine facturation — mention prélèvement immédiat sur changement
{
  const plan = getBillingPlan("extra");
  const view = describeUpcomingInvoice(upcoming(), plan, baseSub());
  assert.ok(
    view.lines.some((l) => l.includes("prélèvement immédiat")),
  );
}

console.log("test-upcoming-invoice-display: OK");
