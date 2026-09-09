/**
 * Suppression one-shot d’un compte (Auth + données + abonnement Stripe).
 * Usage: npx tsx scripts/purge-user-by-email.ts yoyo270706@gmail.com
 */
import { createClient } from "@supabase/supabase-js";

import { loadEnvFiles } from "./lib/load-env-files";

loadEnvFiles(process.cwd(), { override: true });

import { getStripe, isStripeConfigured } from "../src/lib/stripe";
import { wipeUserLocalData } from "../src/services/account/delete-account";

const email = (process.argv[2] || "").trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error("Usage: npx tsx scripts/purge-user-by-email.ts <email>");
  process.exit(1);
}

async function findSupabaseUserId(): Promise<string | null> {
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

async function cancelStripeForEmail(): Promise<number> {
  if (!isStripeConfigured()) return 0;
  const stripe = getStripe();
  const customers = await stripe.customers.list({ email, limit: 20 });
  let canceled = 0;
  for (const customer of customers.data) {
    const subs = await stripe.subscriptions.list({
      customer: customer.id,
      status: "all",
      limit: 50,
    });
    for (const sub of subs.data) {
      if (["canceled", "incomplete_expired"].includes(sub.status)) continue;
      await stripe.subscriptions.cancel(sub.id);
      canceled += 1;
      console.log(`Stripe sub annulée: ${sub.id} (${sub.status})`);
    }
  }
  return canceled;
}

async function main() {
  console.log(`Purge compte: ${email}`);

  const userId = await findSupabaseUserId();
  if (!userId) {
    console.log("Aucun utilisateur Supabase avec cet email.");
    const n = await cancelStripeForEmail();
    console.log(`Abonnements Stripe annulés (par email): ${n}`);
    console.log("OK — email libre pour réinscription (Auth déjà absent).");
    return;
  }

  console.log(`UserId: ${userId}`);
  const result = await wipeUserLocalData(userId);
  console.log("wipeUserLocalData:", result);

  // Filet de sécurité : annuler toute sub Stripe restante liée à l’email
  const n = await cancelStripeForEmail();
  console.log(`Abonnements Stripe supplémentaires annulés: ${n}`);

  const stillThere = await findSupabaseUserId();
  if (stillThere) {
    console.error("ÉCHEC: le user Auth existe encore:", stillThere);
    process.exit(1);
  }

  console.log("OK — compte Auth + données + abo nettoyés. Email réutilisable.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
