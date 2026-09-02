/**
 * Tests architecture facturation Stripe (plans, entitlements, store local).
 */
import assert from "assert";
import { rm } from "fs/promises";

import { BILLING_PLANS, buildStripePriceToPlanMap, getBillingPlan, planIdFromStripePriceId } from "../src/config/billing";
import { userSubscriptionFile } from "../src/config/paths";
import { isStripeConfigured } from "../src/lib/stripe";
import {
  hasPremiumAccess,
  resolveAccessBadge,
} from "../src/services/billing/access";
import {
  entitlementsFailOpen,
  getUserEntitlements,
  hasEntitlement,
  isPremiumStatus,
  requireEntitlement,
} from "../src/services/billing/entitlements";
import { planFromSubscription } from "../src/services/billing/apply-subscription";
import {
  getUserSubscription,
  upsertSubscriptionPatch,
} from "../src/services/billing/store";
import { ensureUserWorkspace, resetUserWorkspaceCache } from "../src/services/auth/workspace";
import { AppError } from "../src/lib/errors";

async function main() {
  // Catalogue
  assert.equal(BILLING_PLANS.free.priceMonthlyEur, null);
  assert.equal(BILLING_PLANS.premium.priceMonthlyEur, 34.99);
  assert.equal(BILLING_PLANS.extra.priceMonthlyEur, 59.99);
  assert.ok(BILLING_PLANS.free.entitlements.includes("analyze"));
  assert.ok(!BILLING_PLANS.free.entitlements.includes("letter_agent"));
  assert.ok(BILLING_PLANS.basique.entitlements.includes("letter_agent"));
  assert.ok(getBillingPlan("premium").entitlements.includes("letter_agent"));

  assert.equal(isPremiumStatus("premium", "active"), true);
  assert.equal(isPremiumStatus("premium", "canceled"), false);
  assert.equal(isPremiumStatus("free", "active"), false);

  // planFromSubscription : price configuré = source de vérité
  const premiumPrice = process.env.STRIPE_PRICE_PREMIUM?.trim();
  if (premiumPrice) {
    assert.equal(
      planFromSubscription({
        status: "active",
        items: { data: [{ price: { id: premiumPrice } }] },
        metadata: {},
      } as never),
      "premium",
    );
    assert.equal(
      planFromSubscription({
        status: "active",
        items: { data: [{ price: { id: "price_other" } }] },
        metadata: { plan: "premium" },
      } as never),
      "free",
    );
  } else {
    assert.equal(
      planFromSubscription({
        status: "active",
        items: { data: [{ price: { id: "price_other" } }] },
        metadata: { plan: "premium" },
      } as never),
      "premium",
    );
  }

  const extraPrice = process.env.STRIPE_PRICE_EXTRA?.trim();
  const proPrice = process.env.STRIPE_PRICE_PRO?.trim();
  if (extraPrice) {
    assert.equal(planIdFromStripePriceId(extraPrice), "extra");
    assert.equal(buildStripePriceToPlanMap().get(extraPrice), "extra");
  }

  // Prod : metadata seule ne doit pas surclasser le price Stripe (bug Pro→Extra fictif).
  if (proPrice && extraPrice) {
    const withMetaOnly = planFromSubscription({
      status: "active",
      metadata: { docmind_plan: "extra", plan: "extra" },
      items: {
        data: [{ price: { id: proPrice } }],
      },
    } as never);
    assert.equal(
      withMetaOnly,
      "pro",
      "metadata extra ignorée si price Stripe = pro",
    );
  }

  // Fail-open : documenté — en test local sans Stripe, true par défaut
  if (!isStripeConfigured()) {
    assert.equal(typeof entitlementsFailOpen(), "boolean");
  }
  assert.equal(hasPremiumAccess("premium", "past_due"), true);
  assert.equal(hasPremiumAccess("premium", "unpaid"), false);
  assert.equal(hasPremiumAccess("premium", "trialing"), true);

  assert.equal(
    resolveAccessBadge({
      plan: "premium",
      status: "active",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      canceledAt: null,
      stripeSubscriptionId: "sub_x",
    }).id,
    "premium_active",
  );
  assert.equal(
    resolveAccessBadge({
      plan: "premium",
      status: "trialing",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      canceledAt: null,
      stripeSubscriptionId: "sub_x",
    }).label,
    "Essai",
  );
  assert.equal(
    resolveAccessBadge({
      plan: "premium",
      status: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date().toISOString(),
      canceledAt: null,
      stripeSubscriptionId: "sub_x",
    }).id,
    "canceling",
  );
  // canceledAt stale sans cancelAtPeriodEnd → Premium actif (resume)
  assert.equal(
    resolveAccessBadge({
      plan: "premium",
      status: "active",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date().toISOString(),
      canceledAt: new Date().toISOString(),
      stripeSubscriptionId: "sub_x",
    }).id,
    "premium_active",
  );
  assert.equal(
    resolveAccessBadge({
      plan: "premium",
      status: "trialing",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date().toISOString(),
      canceledAt: new Date().toISOString(),
      stripeSubscriptionId: "sub_x",
    }).id,
    "canceling",
  );
  assert.equal(
    resolveAccessBadge({
      plan: "free",
      status: "canceled",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      canceledAt: new Date().toISOString(),
      stripeSubscriptionId: null,
    }).id,
    "canceled",
  );

  resetUserWorkspaceCache();
  const userId = "user-billing-test";
  await ensureUserWorkspace(userId);

  // Par défaut : free
  const initial = await getUserSubscription(userId);
  assert.equal(initial.plan, "free");
  assert.equal(initial.status, "active");

  // Sans Stripe configuré → Premium ouvert (dev)
  if (!isStripeConfigured()) {
    const ents = await getUserEntitlements(userId);
    assert.ok(ents.includes("letter_agent"), "dev: letter_agent ouvert");
    await requireEntitlement(userId, "letter_agent");
  } else {
    const ok = await hasEntitlement(userId, "letter_agent");
    assert.equal(ok, false);

    await upsertSubscriptionPatch(userId, {
      plan: "premium",
      status: "active",
      stripeCustomerId: "cus_test",
      stripeSubscriptionId: "sub_test",
      stripePriceId: "price_test",
      currentPeriodEnd: new Date(Date.now() + 86400000).toISOString(),
    });

    assert.equal(await hasEntitlement(userId, "letter_agent"), true);

    await upsertSubscriptionPatch(userId, {
      plan: "free",
      status: "canceled",
      cancelAtPeriodEnd: false,
    });

    try {
      await requireEntitlement(userId, "letter_agent");
      assert.fail("devrait refuser letter_agent sur free");
    } catch (error) {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "FORBIDDEN");
    }

    // Simulation remboursement complet → révocation locale
    await upsertSubscriptionPatch(userId, {
      plan: "premium",
      status: "active",
      stripeCustomerId: "cus_refund",
      stripeSubscriptionId: "sub_refund",
    });
    await upsertSubscriptionPatch(userId, {
      plan: "free",
      status: "canceled",
      cancelAtPeriodEnd: false,
      canceledAt: new Date().toISOString(),
      lastWebhookEventType: "charge.refunded",
      lastWebhookEventId: "evt_refund_test",
      lastWebhookAt: new Date().toISOString(),
    });
    const revoked = await getUserSubscription(userId);
    assert.equal(revoked.plan, "free");
    assert.equal(hasPremiumAccess(revoked.plan, revoked.status), false);
    assert.equal(revoked.lastWebhookEventType, "charge.refunded");
  }

  // Upsert isolé
  await upsertSubscriptionPatch(userId, {
    stripeCustomerId: "cus_iso_billing",
  });
  const after = await getUserSubscription(userId);
  assert.equal(after.stripeCustomerId, "cus_iso_billing");
  assert.equal(after.userId, userId);

  // Cleanup
  await rm(userSubscriptionFile(userId), { force: true });

  console.log("test:billing OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
