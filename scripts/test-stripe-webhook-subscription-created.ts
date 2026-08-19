/**
 * Régression customer.subscription.created (payload beta réel + thin payload).
 */
import assert from "node:assert/strict";

import type Stripe from "stripe";

import {
  planFromSubscription,
  readSubscriptionPriceId,
} from "../src/services/billing/apply-subscription";
import { processStripeWebhookEvent } from "../src/services/billing/webhook";

const USER_ID = "08fc21fa-990d-486f-a7f6-2c206b19bbab";
const PRICE_REAL = "price_1TxTYPIKoB72aP1GU41L5z0m";
const PRICE_PREMIUM_ENV = "price_1U6CAcIKoB72aP1G11JUpcgD";

function buildRealSubscription(): Stripe.Subscription {
  return {
    id: "sub_1U46jkIKoB72aP1Gub8N3QjR",
    object: "subscription",
    customer: "cus_V4FEFK0hGsIxy8",
    status: "active",
    currency: "eur",
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    metadata: {
      docmind_user_id: USER_ID,
      plan: "premium",
    },
    items: {
      object: "list",
      data: [
        {
          id: "si_test",
          object: "subscription_item",
          price: {
            id: PRICE_REAL,
            object: "price",
            unit_amount: 2000,
            currency: "eur",
            recurring: { interval: "month", interval_count: 1 },
          },
          current_period_start: Math.floor(Date.now() / 1000) - 3600,
          current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
        },
      ],
      has_more: false,
      url: "/v1/subscription_items",
    },
  } as unknown as Stripe.Subscription;
}

function buildEvent(sub: Stripe.Subscription, id: string): Stripe.Event {
  return {
    id,
    object: "event",
    api_version: "2026-06-24.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: "customer.subscription.created",
    data: { object: sub },
  } as Stripe.Event;
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

async function testReadPriceIdWithoutThrow() {
  const sub = buildRealSubscription();
  assert.equal(readSubscriptionPriceId(sub), PRICE_REAL);

  const thin = {
    ...sub,
    items: undefined,
  } as unknown as Stripe.Subscription;
  assert.equal(readSubscriptionPriceId(thin), null);
  assert.doesNotThrow(() => planFromSubscription(thin));
  console.log("OK readSubscriptionPriceId sans throw sur payload thin");
}

async function testPlanMappingWithConfiguredPrice() {
  await withEnv({ STRIPE_PRICE_PREMIUM: PRICE_PREMIUM_ENV }, async () => {
    const sub = buildRealSubscription();
    assert.equal(planFromSubscription(sub), "free", "20€ price ≠ STRIPE_PRICE_PREMIUM");
    assert.equal(
      planFromSubscription({
        ...sub,
        items: {
          ...sub.items,
          data: [
            {
              ...sub.items!.data[0],
              price: { ...sub.items!.data[0].price, id: PRICE_PREMIUM_ENV },
            },
          ],
        },
      } as unknown as Stripe.Subscription),
      "premium",
    );
  });
  console.log("OK planFromSubscription avec STRIPE_PRICE_PREMIUM");
}

async function testDispatchDoesNotThrowOnThinPayload() {
  const store = new Set<string>();
  const thinSub = {
    id: "sub_thin",
    customer: "cus_thin",
    status: "active",
    metadata: { docmind_user_id: USER_ID, plan: "premium" },
  } as unknown as Stripe.Subscription;
  const event = buildEvent(thinSub, `evt_thin_${Date.now()}`);

  const result = await processStripeWebhookEvent(event, {
    isClaimed: async (id) => store.has(id),
    claim: async (id) => {
      store.add(id);
      return true;
    },
    dispatch: async (evt) => {
      const sub = evt.data.object as Stripe.Subscription;
      assert.doesNotThrow(() => planFromSubscription(sub));
      return { handled: true };
    },
  });

  assert.equal(result.handled, true);
  console.log("OK dispatch thin payload sans TypeError");
}

async function testIdempotentDuplicateEvent() {
  const store = new Set<string>();
  let dispatches = 0;
  const sub = buildRealSubscription();
  const event = buildEvent(sub, `evt_dup_${Date.now()}`);

  const deps = {
    isClaimed: async (id: string) => store.has(id),
    claim: async (id: string) => {
      store.add(id);
      return true;
    },
    dispatch: async () => {
      dispatches += 1;
      return { handled: true };
    },
  };

  const first = await processStripeWebhookEvent(event, deps);
  const second = await processStripeWebhookEvent(event, deps);
  assert.equal(first.handled, true);
  assert.equal(second.handled, true);
  assert.equal(dispatches, 1, "duplicate event → single dispatch");
  console.log("OK événement dupliqué idempotent");
}

async function main() {
  await testReadPriceIdWithoutThrow();
  await testPlanMappingWithConfiguredPrice();
  await testDispatchDoesNotThrowOnThinPayload();
  await testIdempotentDuplicateEvent();
  console.log("\nOK test-stripe-webhook-subscription-created");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
