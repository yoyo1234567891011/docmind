/**
 * Vérifie cohérence Stripe ↔ DB locale ↔ badges / droits pour un user.
 */
import { readFile } from "fs/promises";
import path from "path";

import { getStripe, isStripeConfigured } from "../src/lib/stripe";
import {
  hasPremiumAccess,
  resolveAccessBadge,
} from "../src/services/billing/access";
import {
  isCancelScheduled,
  planFromSubscription,
} from "../src/services/billing/apply-subscription";
import { getUserSubscription } from "../src/services/billing/store";
import { syncUserSubscriptionFromStripe } from "../src/services/billing/sync";

const ROOT = process.cwd();
const userId = process.argv[2] || "eccede1d-bc04-4511-8a3a-f19e16a0f3db";

async function loadEnv() {
  for (const fileName of [".env.local", ".env"]) {
    try {
      const content = await readFile(path.join(ROOT, fileName), "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
      }
    } catch {
      // optional
    }
  }
}

async function main() {
  await loadEnv();
  const issues: string[] = [];

  if (!isStripeConfigured()) {
    console.log("SKIP: Stripe non configuré");
    process.exit(0);
  }

  const before = await getUserSubscription(userId);
  const sync = await syncUserSubscriptionFromStripe(userId);
  const local = sync.subscription;
  const badge = resolveAccessBadge(local);
  const premium = hasPremiumAccess(local.plan, local.status);

  console.log("LOCAL", {
    plan: local.plan,
    status: local.status,
    cancelAtPeriodEnd: local.cancelAtPeriodEnd,
    periodEnd: local.currentPeriodEnd,
    badge: badge.label,
    premium,
    synced: sync.synced,
  });

  if (!local.stripeSubscriptionId) {
    issues.push("Pas de stripeSubscriptionId local");
  } else {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(local.stripeSubscriptionId);
    const scheduled = isCancelScheduled(sub);
    const stripePlan = planFromSubscription(sub);

    console.log("STRIPE", {
      status: sub.status,
      cancel_at_period_end: sub.cancel_at_period_end,
      cancel_at: sub.cancel_at,
      canceled_at: sub.canceled_at,
      scheduled,
      plan: stripePlan,
    });

    if (local.status !== sub.status) {
      issues.push(`status mismatch local=${local.status} stripe=${sub.status}`);
    }
    if (local.cancelAtPeriodEnd !== scheduled) {
      issues.push(
        `cancelAtPeriodEnd mismatch local=${local.cancelAtPeriodEnd} stripeScheduled=${scheduled}`,
      );
    }
    if (scheduled && badge.id !== "canceling") {
      issues.push(`badge attendu Expire bientôt, reçu ${badge.label}`);
    }
    if (
      !scheduled &&
      sub.status === "active" &&
      stripePlan === "premium" &&
      badge.id !== "premium_active"
    ) {
      issues.push(`badge attendu Premium actif, reçu ${badge.label}`);
    }
    if (scheduled && !premium) {
      issues.push("Annulation planifiée mais premium=false (devrait rester true)");
    }
  }

  // Sanity badges unitaires
  if (
    resolveAccessBadge({
      plan: "premium",
      status: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: null,
      canceledAt: null,
      stripeSubscriptionId: "x",
    }).id !== "canceling"
  ) {
    issues.push("badge canceling cassé");
  }

  console.log("PREVIOUS", {
    cancelAtPeriodEnd: before.cancelAtPeriodEnd,
    status: before.status,
  });

  if (issues.length) {
    console.error("ISSUES", issues);
    process.exit(1);
  }
  console.log("OK — aucune incohérence détectée");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
