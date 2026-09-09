/**
 * Vérifie prod : price Stripe, quotas API (utilisateur éphémère).
 * Usage: npx tsx scripts/verify-prod-billing-quotas.ts
 */
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { loadEnvFiles } from "./lib/load-env-files";

loadEnvFiles();

const BASE = (
  process.env.PROD_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://docmind-blond.vercel.app"
).replace(/\/$/, "");

const PRICE_ID =
  process.env.STRIPE_PRICE_PREMIUM?.trim() ||
  "price_1U6CAcIKoB72aP1G11JUpcgD";

async function verifyStripePrice() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    console.log("SKIP Stripe price: STRIPE_SECRET_KEY absent en local");
    return;
  }
  const stripe = new Stripe(key);
  try {
    const price = await stripe.prices.retrieve(PRICE_ID, {
      expand: ["product"],
    });
    const eur = price.unit_amount != null ? price.unit_amount / 100 : null;
    console.log("OK Stripe price:", {
      id: price.id,
      active: price.active,
      eurPerMonth: eur,
      currency: price.currency,
      recurring: price.recurring?.interval,
    });
    if (!price.active) throw new Error("Price Stripe inactif");
    if (eur !== 10) {
      console.warn(`WARN: montant Stripe = ${eur}€ (UI affiche 10€)`);
    }
  } catch (error) {
    console.error(
      "FAIL Stripe price:",
      error instanceof Error ? error.message : error,
    );
    console.log(
      "→ Vérifiez que le price existe sur le compte Stripe lié à STRIPE_SECRET_KEY (test vs live).",
    );
  }
}

async function verifyProdQuotas() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !service) {
    console.log("SKIP quotas prod: Supabase env absent");
    return;
  }

  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `quota-verify+${Date.now()}@docmind.test`;
  const password = `Qv!${Date.now()}`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(created.error?.message || "createUser failed");
  }

  const anon = createClient(
    url,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
  );
  const signed = await anon.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) {
    throw new Error(signed.error?.message || "signIn failed");
  }

  const res = await fetch(`${BASE}/api/quotas`, {
    headers: {
      Authorization: `Bearer ${signed.data.session.access_token}`,
      Cookie: `sb-access-token=${signed.data.session.access_token}`,
    },
    cache: "no-store",
  });

  // DocMind utilise surtout les cookies Supabase — Playwright-style session via API:
  if (!res.ok) {
    // Retry avec cookie header from supabase SSR naming
    const res2 = await fetch(`${BASE}/api/quotas`, {
      headers: {
        Authorization: `Bearer ${signed.data.session.access_token}`,
      },
      cache: "no-store",
    });
    if (!res2.ok) {
      throw new Error(`/api/quotas ${res2.status} — auth prod requiert navigateur`);
    }
    const payload2 = (await res2.json()) as {
      success: boolean;
      data?: { plan: string; items: Array<{ metric: string; limit: number; remaining: number }> };
    };
    reportQuotas(payload2);
  } else {
    const payload = (await res.json()) as {
      success: boolean;
      data?: { plan: string; items: Array<{ metric: string; limit: number; remaining: number }> };
    };
    reportQuotas(payload);
  }

  await admin.auth.admin.deleteUser(created.data.user.id).catch(() => undefined);
}

function reportQuotas(payload: {
  success: boolean;
  data?: {
    plan: string;
    items: Array<{ metric: string; limit: number; remaining: number }>;
  };
}) {
  if (!payload.success || !payload.data) {
    throw new Error("Réponse /api/quotas invalide");
  }
  const analyze = payload.data.items.find((i) => i.metric === "analyze");
  if (!analyze) throw new Error("Métrique analyze absente");
  console.log("OK quotas prod (Free user):", {
    plan: payload.data.plan,
    analyzeLimit: analyze.limit,
    analyzeRemaining: analyze.remaining,
  });
  if (analyze.limit !== 20) {
    throw new Error(`QUOTA_FREE_ANALYZE attendu 20, reçu ${analyze.limit}`);
  }
}

async function main() {
  console.log("=== Vérification prod billing + quotas ===\n");
  console.log("Base URL:", BASE);
  console.log("Price ID:", PRICE_ID);
  console.log("");
  await verifyStripePrice();
  await verifyProdQuotas();
  console.log("\n=== Vérifications automatisées OK ===");
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
