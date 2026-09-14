/**
 * Unit checks — gate paiement changement de plan (sans Stripe live).
 * Usage: npx tsx scripts/test-plan-change-payment-gate.ts
 */
import assert from "node:assert/strict";

import { classifyPlanChangePayment } from "../src/services/billing/change-plan";
import {
  assertProrationInvoiceSettled,
  PLAN_CHANGE_PRORATION_UPDATE,
} from "../src/services/billing/plan-change-full-price";
import type Stripe from "stripe";

assert.equal(
  PLAN_CHANGE_PRORATION_UPDATE.payment_behavior,
  "pending_if_incomplete",
);
assert.equal(PLAN_CHANGE_PRORATION_UPDATE.proration_behavior, "always_invoice");

function sub(partial: {
  pending_update?: unknown;
}): Stripe.Subscription {
  return {
    pending_update: partial.pending_update ?? null,
  } as Stripe.Subscription;
}

function inv(partial: {
  status?: Stripe.Invoice.Status | null;
  amount_due?: number;
}): Stripe.Invoice {
  return {
    status: partial.status ?? "open",
    amount_due: partial.amount_due ?? 0,
  } as Stripe.Invoice;
}

function pi(status: Stripe.PaymentIntent.Status): Stripe.PaymentIntent {
  return { status } as Stripe.PaymentIntent;
}

assert.equal(
  classifyPlanChangePayment({
    subscription: sub({}),
    invoice: inv({ status: "paid", amount_due: 0 }),
    paymentIntent: pi("succeeded"),
  }),
  "settled",
);

assert.equal(
  classifyPlanChangePayment({
    subscription: sub({}),
    invoice: inv({ status: "open", amount_due: 0 }),
    paymentIntent: null,
  }),
  "settled",
);

assert.equal(
  classifyPlanChangePayment({
    subscription: sub({ pending_update: { subscription_items: [] } }),
    invoice: inv({ status: "open", amount_due: 1234 }),
    paymentIntent: pi("requires_action"),
  }),
  "action_required",
);

assert.equal(
  classifyPlanChangePayment({
    subscription: sub({ pending_update: { subscription_items: [] } }),
    invoice: inv({ status: "open", amount_due: 500 }),
    paymentIntent: null,
  }),
  "action_required",
);

assert.equal(
  classifyPlanChangePayment({
    subscription: sub({ pending_update: { subscription_items: [] } }),
    invoice: inv({ status: "open", amount_due: 500 }),
    paymentIntent: pi("requires_payment_method"),
  }),
  "failed",
);

assert.equal(
  classifyPlanChangePayment({
    subscription: sub({}),
    invoice: inv({ status: "open", amount_due: 999 }),
    paymentIntent: pi("requires_action"),
  }),
  "action_required",
);

{
  let threw = false;
  try {
    assertProrationInvoiceSettled(
      inv({ status: "open", amount_due: 1500 }),
      "pro",
    );
  } catch {
    threw = true;
  }
  assert.equal(threw, true, "open + due > 0 must block apply");
}

assertProrationInvoiceSettled(inv({ status: "paid", amount_due: 0 }), "pro");
assertProrationInvoiceSettled(inv({ status: "open", amount_due: 0 }), "pro");

console.log("test-plan-change-payment-gate: OK");
