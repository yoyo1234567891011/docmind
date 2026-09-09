/**
 * POST signed webhook to prod/local for integration test.
 * Usage: npx tsx scripts/post-stripe-webhook-test.ts [baseUrl]
 */
import { loadEnvFiles } from "./lib/load-env-files";

loadEnvFiles();

import Stripe from "stripe";

const BASE = (process.argv[2] || "https://docmind-blond.vercel.app").replace(
  /\/$/,
  "",
);
const USER_ID = "08fc21fa-990d-486f-a7f6-2c206b19bbab";

async function main() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET missing");

  const payload = {
    id: `evt_test_${Date.now()}`,
    object: "event",
    api_version: "2026-06-24.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: "customer.subscription.created",
    data: {
      object: {
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
              id: "si_test_item",
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
      },
    },
  };

  const body = JSON.stringify(payload);
  const stripe = new Stripe("sk_test_placeholder");
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret,
  });

  for (const path of ["/api/stripe/webhook", "/api/billing/webhook"]) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature,
      },
      body,
    });
    const text = await res.text();
    console.log(path, res.status, text.slice(0, 300));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
