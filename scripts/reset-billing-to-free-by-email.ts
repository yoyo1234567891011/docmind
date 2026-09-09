/**
 * Annule l'abonnement Stripe immédiatement et remet le compte en plan gratuit.
 * Usage: npx tsx scripts/reset-billing-to-free-by-email.ts yoyo270709@gmail.com
 */
import { createClient } from "@supabase/supabase-js";

import { loadEnvFiles } from "./lib/load-env-files";

loadEnvFiles(process.cwd(), { override: true });
loadEnvFiles(process.cwd(), {
  override: true,
  files: [".env.cloud-beta.local", ".env.stripe-prices.local"],
});

import { isStripeConfigured } from "../src/lib/stripe";
import { cancelPremiumSubscription } from "../src/services/billing/cancel";
import { getUserSubscription } from "../src/services/billing/store";
import { syncUserSubscriptionFromStripe } from "../src/services/billing/sync";

const email = (process.argv[2] || "").trim().toLowerCase();
if (!email.includes("@")) {
  console.error("Usage: npx tsx scripts/reset-billing-to-free-by-email.ts <email>");
  process.exit(1);
}

async function findUserId(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !service) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL manquants");
  }
  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const hit = data.users.find(
      (u) => u.email?.trim().toLowerCase() === email,
    );
    if (hit?.id) return hit.id;
    if (data.users.length < 200) break;
    page += 1;
  }
  return null;
}

async function main() {
  if (!isStripeConfigured()) {
    throw new Error("STRIPE_SECRET_KEY manquant");
  }

  const userId = await findUserId();
  if (!userId) {
    throw new Error(`Utilisateur introuvable: ${email}`);
  }

  const before = await getUserSubscription(userId);
  console.log("Avant:", {
    plan: before.plan,
    status: before.status,
    stripeSubscriptionId: before.stripeSubscriptionId,
    stripePriceId: before.stripePriceId,
  });

  if (before.stripeSubscriptionId && before.status !== "canceled") {
    await cancelPremiumSubscription({ userId, immediately: true });
    console.log("→ Abonnement Stripe annulé immédiatement");
  } else {
    console.log("→ Pas d'abonnement actif à annuler");
  }

  await syncUserSubscriptionFromStripe(userId);
  const after = await getUserSubscription(userId);
  console.log("Après:", {
    plan: after.plan,
    status: after.status,
    stripeSubscriptionId: after.stripeSubscriptionId,
    stripePriceId: after.stripePriceId,
    isPremium: after.plan !== "free",
  });

  if (after.plan !== "free") {
    throw new Error(`Échec: plan encore ${after.plan}`);
  }

  console.log(`OK — ${email} est sur plan Gratuit, prêt pour un nouveau checkout.`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
