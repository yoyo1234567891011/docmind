/**
 * Reproduit customer.subscription.created (payload réel beta).
 */
import { loadEnvFiles } from "./lib/load-env-files";

loadEnvFiles();

import type Stripe from "stripe";

import { applyStripeSubscription } from "../src/services/billing/apply-subscription";
import {
  handleStripeWebhookEvent,
} from "../src/services/billing/webhook";
import {
  isStripeWebhookEventClaimed,
} from "../src/services/persistence/webhook-events-pg";
import { getUserSubscription } from "../src/services/billing/store";

const USER_ID = "08fc21fa-990d-486f-a7f6-2c206b19bbab";

function buildSubscription(): Stripe.Subscription {
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
            id: "price_1TxTYPIKoB72aP1GU41L5z0m",
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

function buildEvent(sub: Stripe.Subscription): Stripe.Event {
  return {
    id: `evt_repro_${Date.now()}`,
    object: "event",
    api_version: "2026-06-24.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: "customer.subscription.created",
    data: { object: sub },
  } as Stripe.Event;
}

async function main() {
  process.env.STRIPE_PRICE_PREMIUM =
    process.env.STRIPE_PRICE_PREMIUM || "price_1U6CAcIKoB72aP1G11JUpcgD";
  process.env.DOCMIND_STORAGE = "persistent";

  console.log("STRIPE_PRICE_PREMIUM =", process.env.STRIPE_PRICE_PREMIUM);
  console.log("DATABASE_URL =", process.env.DATABASE_URL ? "SET" : "MISSING");
  console.log("REDIS_URL =", process.env.REDIS_URL ? "SET" : "MISSING");

  const sub = buildSubscription();
  const event = buildEvent(sub);

  console.log("\n--- Test applyStripeSubscription direct ---");
  try {
    await applyStripeSubscription(userIdFix(), sub, {
      id: event.id,
      type: event.type,
      created: event.created,
    });
    const record = await getUserSubscription(USER_ID);
    console.log("OK apply:", {
      plan: record.plan,
      status: record.status,
      stripePriceId: record.stripePriceId,
    });
  } catch (error) {
    console.error("FAIL applyStripeSubscription:");
    console.error(error);
    process.exitCode = 1;
  }

  console.log("\n--- Test handleStripeWebhookEvent full ---");
  const event2 = buildEvent(sub);
  event2.id = `evt_repro_full_${Date.now()}`;
  try {
    const result = await handleStripeWebhookEvent(event2);
    console.log("OK handle:", result);
    const claimed = await isStripeWebhookEventClaimed(event2.id);
    console.log("claimed:", claimed);
  } catch (error) {
    console.error("FAIL handleStripeWebhookEvent:");
    console.error(error);
    if (error instanceof Error) {
      console.error("stack:", error.stack);
    }
    process.exitCode = 1;
  }
}

function userIdFix() {
  return USER_ID;
}

main();
