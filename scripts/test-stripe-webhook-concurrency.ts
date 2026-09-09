/**
 * Concurrence réelle webhooks Stripe :
 * - 2 workers même event.id → 1 seul dispatch
 * - crash pendant dispatch (avant claim) → retry possible, pas d’événement perdu
 * - claim définitif uniquement après succès
 * - hors-ordre refund/renewal → Premium correct
 */
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";

import { applyStripeSubscription } from "../src/services/billing/apply-subscription";
import { processStripeWebhookEvent } from "../src/services/billing/webhook";
import {
  ensureUserWorkspace,
  resetUserWorkspaceCache,
} from "../src/services/auth/workspace";
import {
  getUserSubscription,
  upsertSubscriptionPatch,
} from "../src/services/billing/store";
import { withKeyedLock } from "../src/lib/keyed-lock";
import type Stripe from "stripe";

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

function fakeEvent(id: string, type = "customer.subscription.updated"): Stripe.Event {
  return {
    id,
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object: {} },
  } as Stripe.Event;
}

function createClaimStore() {
  const claimed = new Set<string>();
  return {
    claimed,
    isClaimed: async (eventId: string) => claimed.has(eventId),
    claim: async (eventId: string, _eventType?: string) => {
      if (claimed.has(eventId)) return false;
      claimed.add(eventId);
      return true;
    },
  };
}

async function testTwoWorkersSingleDispatch() {
  const store = createClaimStore();
  let dispatches = 0;
  const event = fakeEvent(`evt_conc_${Date.now()}`);

  const worker = () =>
    withKeyedLock(`billing:webhook:${event.id}`, () =>
      processStripeWebhookEvent(event, {
        isClaimed: store.isClaimed,
        claim: store.claim,
        dispatch: async () => {
          dispatches += 1;
          await new Promise((r) => setTimeout(r, 40));
          return { handled: true };
        },
      }),
    );

  const [a, b] = await Promise.all([worker(), worker()]);
  assert.equal(dispatches, 1, "un seul dispatch pour 2 workers");
  assert.equal(store.claimed.has(event.id), true);
  assert.equal(a.handled, true);
  assert.equal(b.handled, true);
  console.log("OK 2 workers → 1 dispatch");
}

async function testCrashBeforeClaimThenRetry() {
  const store = createClaimStore();
  let dispatches = 0;
  let crashOnce = true;
  const event = fakeEvent(`evt_crash_${Date.now()}`);

  const worker = () =>
    withKeyedLock(`billing:webhook:${event.id}`, () =>
      processStripeWebhookEvent(event, {
        isClaimed: store.isClaimed,
        claim: async (id, type) => {
          // Prouve qu’on ne claim JAMAIS avant le succès du dispatch.
          assert.ok(
            dispatches > 0,
            "claim ne doit pas précéder un dispatch réussi",
          );
          return store.claim(id, type);
        },
        dispatch: async () => {
          dispatches += 1;
          if (crashOnce) {
            crashOnce = false;
            // Crash simulé PENDANT le traitement, avant tout claim définitif.
            throw new Error("simulated crash between dispatch start and claim");
          }
          return { handled: true };
        },
      }),
    );

  await assert.rejects(() => worker(), /simulated crash/);
  assert.equal(
    store.claimed.has(event.id),
    false,
    "pas de claim fantôme après crash",
  );

  // Worker concurrent / retry Stripe — doit pouvoir reprendre.
  const retry = await worker();
  assert.equal(retry.handled, true);
  assert.equal(dispatches, 2, "retry après crash (1 crash + 1 succès)");
  assert.equal(store.claimed.has(event.id), true, "claim seulement après succès");
  console.log("OK crash avant claim → retry possible, événement non perdu");
}

async function testNoClaimWhenHandledFalse() {
  const store = createClaimStore();
  const event = fakeEvent(`evt_unresolved_${Date.now()}`);
  const result = await processStripeWebhookEvent(event, {
    isClaimed: store.isClaimed,
    claim: store.claim,
    dispatch: async () => ({ handled: false }),
  });
  assert.equal(result.handled, false);
  assert.equal(store.claimed.has(event.id), false);
  console.log("OK handled:false → pas de claim");
}

async function testOutOfOrderRefundVsRenewal() {
  const userId = `wh-order-${Date.now()}`;
  resetUserWorkspaceCache();
  await ensureUserWorkspace(userId);

  await withEnv(
    {
      DOCMIND_STORAGE: "fs",
      STRIPE_SECRET_KEY: undefined,
      STRIPE_PRICE_PREMIUM: undefined,
    },
    async () => {
      const subId = "sub_wh_order";
      const active = {
        id: subId,
        customer: "cus_wh",
        status: "active",
        cancel_at_period_end: false,
        cancel_at: null,
        canceled_at: null,
        items: { data: [{ price: { id: "price_x" } }] },
        metadata: { plan: "premium" },
      };

      // Renewal récent
      await applyStripeSubscription(userId, active as never, {
        id: "evt_renew",
        type: "invoice.paid",
        created: 5_000,
      });
      let sub = await getUserSubscription(userId);
      assert.equal(sub.plan, "premium");

      // Refund/cancel plus ancien — doit être ignoré (sous verrou)
      await Promise.all([
        upsertSubscriptionPatch(
          userId,
          {
            plan: "free",
            status: "canceled",
            lastWebhookEventId: "evt_old_refund",
            lastWebhookEventType: "charge.refunded",
            lastWebhookAt: new Date(1_000 * 1000).toISOString(),
          },
          { webhookCreatedSec: 1_000 },
        ),
        applyStripeSubscription(userId, active as never, {
          id: "evt_renew_2",
          type: "customer.subscription.updated",
          created: 6_000,
        }),
      ]);

      sub = await getUserSubscription(userId);
      assert.equal(sub.plan, "premium", "renewal gagne sur refund ancien");
      assert.notEqual(sub.status, "canceled");

      // Cancel/deleted plus récent → free
      await applyStripeSubscription(
        userId,
        {
          ...active,
          status: "canceled",
          canceled_at: 7_000,
        } as never,
        {
          id: "evt_deleted",
          type: "customer.subscription.deleted",
          created: 7_000,
        },
      );
      sub = await getUserSubscription(userId);
      assert.equal(sub.plan, "free");

      // Stale active concurrent
      await Promise.all([
        applyStripeSubscription(userId, active as never, {
          id: "evt_stale",
          type: "customer.subscription.updated",
          created: 2_000,
        }),
        applyStripeSubscription(
          userId,
          { ...active, status: "canceled", canceled_at: 8_000 } as never,
          {
            id: "evt_new_cancel",
            type: "customer.subscription.deleted",
            created: 8_000,
          },
        ),
      ]);
      sub = await getUserSubscription(userId);
      assert.equal(sub.plan, "free", "cancel récent gagne sur active ancien");
      assert.equal(sub.status, "canceled");
    },
  );

  await rm(path.join(process.cwd(), "data", "users", userId), {
    recursive: true,
    force: true,
  }).catch(() => undefined);
  console.log("OK hors-ordre refund/cancel/renewal → Premium correct");
}

async function main() {
  await testTwoWorkersSingleDispatch();
  await testCrashBeforeClaimThenRetry();
  await testNoClaimWhenHandledFalse();
  await testOutOfOrderRefundVsRenewal();
  console.log("\nOK test-stripe-webhook-concurrency");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
