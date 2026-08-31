/**
 * Tests unitaires — prix catalogue complet au changement de plan.
 * Usage: npx tsx scripts/test-upcoming-invoice-display.ts
 */
import assert from "node:assert/strict";

import { getBillingPlan } from "../src/config/billing";
import {
  describePlanChangeMessage,
  describePlanChangePreview,
  describeUpcomingInvoice,
} from "../src/lib/billing/upcoming-display";
import {
  catalogChargeMatchesInvoice,
  catalogPlanMonthlyEur,
} from "../src/services/billing/plan-change-full-price";
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

function previewPremiumToExtra(): BillingPlanChangePreview {
  return {
    currentPlan: "premium",
    targetPlan: "extra",
    currentPlanName: "Premium",
    targetPlanName: "Extra",
    currentMonthlyEur: 34.99,
    targetMonthlyEur: 59.99,
    immediateAmountDue: 59.99,
    currency: "EUR",
    isUpgrade: true,
    nextBillingDate: "2026-09-29T00:00:00.000Z",
    nextMonthlyEur: 59.99,
    available: true,
    note: null,
  };
}

function previewExtraToPremium(): BillingPlanChangePreview {
  return {
    currentPlan: "extra",
    targetPlan: "premium",
    currentPlanName: "Extra",
    targetPlanName: "Premium",
    currentMonthlyEur: 59.99,
    targetMonthlyEur: 34.99,
    immediateAmountDue: 34.99,
    currency: "EUR",
    isUpgrade: false,
    nextBillingDate: "2026-09-29T00:00:00.000Z",
    nextMonthlyEur: 34.99,
    available: true,
    note: null,
  };
}

// Prix catalogue
{
  assert.equal(catalogPlanMonthlyEur("extra"), 59.99);
  assert.equal(catalogPlanMonthlyEur("premium"), 34.99);
  assert.equal(catalogPlanMonthlyEur("pro"), 19.99);
}

// Aperçu Premium → Extra : 59,99 € plein
{
  const lines = describePlanChangePreview(previewPremiumToExtra());
  assert.ok(lines.some((l) => l.includes("59,99")));
  assert.ok(lines.some((l) => l.includes("prix mensuel complet")));
}

// Downgrade Extra → Premium : 34,99 € plein (pas crédit)
{
  const lines = describePlanChangePreview(previewExtraToPremium());
  assert.ok(lines.some((l) => l.includes("34,99")));
}

// Message après succès
{
  const immediate: BillingImmediateInvoice = {
    id: "in_1",
    number: "ABC-001",
    status: "paid",
    amountDue: 59.99,
    amountPaid: 59.99,
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
  assert.ok(msg.includes("59,99"));
  assert.ok(msg.includes("prix du plan Extra"));
}

// Validation montant facture
{
  assert.ok(catalogChargeMatchesInvoice(59.99, 59.99));
  assert.ok(!catalogChargeMatchesInvoice(59.99, 39.97));
}

// Prochaine facturation
{
  const plan = getBillingPlan("extra");
  const view = describeUpcomingInvoice(upcoming(), plan, baseSub());
  assert.ok(view.lines.some((l) => l.includes("prix mensuel complet")));
}

console.log("test-upcoming-invoice-display: OK");
