/**
 * Tests unitaires — affichage changement de plan (prorata) + prochains prélèvements.
 * Usage: npx tsx scripts/test-upcoming-invoice-display.ts
 */
import assert from "node:assert/strict";

import { getBillingPlan } from "../src/config/billing";
import { formatDateTime } from "../src/lib/format";
import {
  describePlanChangeMessage,
  describePlanChangePreview,
  describeUpcomingInvoice,
  PLAN_CHANGE_HINT,
  resolveNextBillingDate,
} from "../src/lib/billing/upcoming-display";
import {
  assertFullCatalogInvoiceCharged,
  assertProrationInvoiceSane,
  catalogChargeMatchesInvoice,
  catalogPlanMonthlyEur,
  PLAN_CHANGE_PRORATION_UPDATE,
} from "../src/services/billing/plan-change-full-price";
import { resolveCatalogRenewalAmountDue } from "../src/services/billing/renewal-catalog";
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
    catalogMonthlyEur: 59.99,
    planName: "Extra",
    intervalLabel: "mensuel",
    openInvoice: null,
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
    immediateAmountDue: 12.34,
    currency: "EUR",
    isUpgrade: true,
    deferredToPeriodEnd: false,
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
    immediateAmountDue: 0,
    currency: "EUR",
    isUpgrade: false,
    deferredToPeriodEnd: true,
    nextBillingDate: "2026-09-29T00:00:00.000Z",
    nextMonthlyEur: 34.99,
    available: true,
    note: null,
  };
}

assert.equal(PLAN_CHANGE_PRORATION_UPDATE.proration_behavior, "always_invoice");
assert.equal(
  PLAN_CHANGE_PRORATION_UPDATE.payment_behavior,
  "pending_if_incomplete",
);
assert.equal(
  "billing_cycle_anchor" in PLAN_CHANGE_PRORATION_UPDATE,
  false,
);
assert.ok(PLAN_CHANGE_HINT.includes("prorata"));

{
  assert.equal(catalogPlanMonthlyEur("extra"), 59.99);
  assert.equal(catalogPlanMonthlyEur("premium"), 34.99);
}

{
  const lines = describePlanChangePreview(previewPremiumToExtra());
  assert.ok(lines.some((l) => /prorata/i.test(l)));
  assert.ok(lines.some((l) => l.includes("12,34")));
  assert.ok(lines.some((l) => /fin de période actuelle/i.test(l)));
  assert.ok(!lines.some((l) => /prix mensuel complet/i.test(l)));
}

{
  const lines = describePlanChangePreview(previewExtraToPremium());
  assert.ok(lines.some((l) => /Passage à Premium le/i.test(l)));
  assert.ok(lines.some((l) => /restez sur Extra/i.test(l)));
  assert.ok(!lines.some((l) => /Confirmer sur Stripe/i.test(l)));
}

{
  const immediate: BillingImmediateInvoice = {
    id: "in_1",
    number: "ABC-001",
    status: "paid",
    amountDue: 12.34,
    amountPaid: 12.34,
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
  assert.ok(msg.includes("12,34"));
  assert.ok(/prorata/i.test(msg));
  assert.ok(/^Passage à Extra confirmé/.test(msg));
}

{
  const periodEnd = "2026-10-14T12:00:00.000Z";
  const msg = describePlanChangeMessage({
    planName: "Pro",
    targetMonthlyEur: 19.99,
    immediateInvoice: null,
    upcoming: upcoming({
      billingDate: "2026-09-14T12:00:00.000Z",
    }),
    subscription: baseSub({
      plan: "pro",
      currentPeriodEnd: periodEnd,
    }),
  });
  assert.ok(msg.includes("Passage à Pro confirmé"));
  assert.ok(msg.includes(formatDateTime(periodEnd)));
}

{
  const periodEnd = "2026-10-14T12:00:00.000Z";
  const date = resolveNextBillingDate(
    upcoming({ billingDate: "2026-09-14T12:00:00.000Z" }),
    baseSub({ currentPeriodEnd: periodEnd }),
  );
  assert.equal(date, periodEnd);
}

{
  assert.ok(catalogChargeMatchesInvoice(59.99, 59.99));
  assert.doesNotThrow(() =>
    assertProrationInvoiceSane(
      {
        status: "paid",
        amount_paid: 1234,
        amount_due: 0,
        lines: { data: [{ amount: 1234, proration: true }] },
      } as never,
      "extra",
    ),
  );
  assert.doesNotThrow(() =>
    assertFullCatalogInvoiceCharged(
      {
        total: 5999,
        subtotal: 5999,
        starting_balance: 0,
        amount_paid: 5999,
        status: "paid",
      } as never,
      59.99,
      "extra",
    ),
  );
}

{
  const resolved = resolveCatalogRenewalAmountDue(
    {
      amount_due: 5893,
      lines: {
        data: [
          { amount: -106, description: "Temps non utilisé sur premium" },
          { amount: 5999, description: "1 × Extra" },
        ],
      },
    } as never,
    59.99,
  );
  assert.equal(resolved, 59.99);
}

{
  const periodEnd = "2026-11-01T00:00:00.000Z";
  const basique = getBillingPlan("basique");
  const view = describeUpcomingInvoice(
    upcoming({
      amountDue: 9.99,
      catalogMonthlyEur: 9.99,
      planName: "Basique",
      billingDate: periodEnd,
      recurringAmount: 9.99,
    }),
    basique,
    baseSub({ plan: "basique", currentPeriodEnd: periodEnd }),
  );
  assert.equal(view.title, "Prochains prélèvements");
  assert.ok(view.rows.some((r) => r.label === "Plan" && /Basique/.test(r.value)));
  assert.ok(view.rows.some((r) => r.label.includes("Date") && r.value.includes(formatDateTime(periodEnd).slice(0, 8))));
  assert.ok(
    view.rows.some(
      (r) => r.label.includes("Montant") && /9[,.]99/.test(r.value),
    ),
  );
  assert.equal(view.tone, "normal");
}

{
  const periodEnd = "2026-11-01T00:00:00.000Z";
  const pro = getBillingPlan("pro");
  const view = describeUpcomingInvoice(
    upcoming({
      amountDue: 19.99,
      catalogMonthlyEur: 19.99,
      planName: "Pro",
      billingDate: periodEnd,
      recurringAmount: 19.99,
    }),
    pro,
    baseSub({ plan: "pro", currentPeriodEnd: periodEnd }),
  );
  assert.ok(view.rows.some((r) => /Pro/.test(r.value) && /19[,.]99/.test(r.value)));
  assert.ok(view.rows.some((r) => r.label.includes("Date")));
}

{
  const free = getBillingPlan("free");
  const view = describeUpcomingInvoice(
    upcoming({
      status: "open",
      amountDue: 19.99,
      planName: "Pro",
      catalogMonthlyEur: 19.99,
      openInvoice: {
        id: "in_open",
        amountDue: 19.99,
        currency: "EUR",
        status: "open",
        dueDate: "2026-09-20T00:00:00.000Z",
        hostedInvoiceUrl: "https://stripe.test/pay",
      },
    }),
    free,
    baseSub({ plan: "pro", status: "past_due" }),
  );
  assert.equal(view.tone, "warning");
  assert.ok(view.rows.some((r) => /À payer/.test(r.value)));
  assert.ok(!view.rows.some((r) => /renouvellement OK/i.test(r.value)));
  assert.ok(view.showPortalHint);
}

{
  const plan = getBillingPlan("extra");
  const view = describeUpcomingInvoice(upcoming(), plan, baseSub());
  assert.ok(view.footnotes.some((l) => /prorata/i.test(l)));
}

console.log("test-upcoming-invoice-display: OK");
