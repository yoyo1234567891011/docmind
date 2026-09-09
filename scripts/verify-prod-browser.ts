/**
 * Vérifie prod via navigateur (cookies Supabase) : quotas + checkout Stripe.
 */
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

import { loadEnvFiles } from "./lib/load-env-files";

loadEnvFiles();

const BASE = "https://docmind-blond.vercel.app";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();

  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `billing-verify+${Date.now()}@docmind.test`;
  const password = `Bv!${Date.now()}`;
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(created.error?.message || "createUser");
  }
  const userId = created.data.user.id;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel(/e-mail|email/i).fill(email);
    await page.getByLabel(/mot de passe|password/i).fill(password);
    await page.getByRole("button", { name: /connexion|se connecter/i }).click();
    await page.waitForURL(/\/(dashboard|analyser|facturation)/, {
      timeout: 30_000,
    });

    const quotasRes = await page.request.get(`${BASE}/api/quotas`);
    const quotasJson = (await quotasRes.json()) as {
      success: boolean;
      data?: {
        plan: string;
        items: Array<{ metric: string; limit: number; remaining: number }>;
      };
    };
    if (!quotasRes.ok() || !quotasJson.success || !quotasJson.data) {
      throw new Error(`quotas ${quotasRes.status()}: ${JSON.stringify(quotasJson)}`);
    }
    const analyze = quotasJson.data.items.find((i) => i.metric === "analyze");
    console.log("OK /api/quotas:", {
      plan: quotasJson.data.plan,
      analyzeLimit: analyze?.limit,
      analyzeRemaining: analyze?.remaining,
    });
    if (analyze?.limit !== 20) {
      throw new Error(`Free limit attendu 20, reçu ${analyze?.limit}`);
    }

    const billingRes = await page.request.get(`${BASE}/api/billing`);
    const billingJson = (await billingRes.json()) as {
      success: boolean;
      data?: { plans?: Array<{ id: string; priceMonthlyEur: number | null }> };
    };
    const premiumPlan = billingJson.data?.plans?.find((p) => p.id === "premium");
    console.log("OK /api/billing premium UI price:", premiumPlan?.priceMonthlyEur, "€/mois");
    if (premiumPlan?.priceMonthlyEur !== 10) {
      throw new Error(`Prix UI attendu 10€, reçu ${premiumPlan?.priceMonthlyEur}`);
    }

    const csrfRes = await page.request.get(`${BASE}/api/csrf`);
    const csrfJson = (await csrfRes.json()) as {
      data?: { token?: string; headerName?: string };
    };
    const token = csrfJson.data?.token;
    const headerName = csrfJson.data?.headerName || "x-csrf-token";
    if (!token) throw new Error("CSRF token manquant");

    const checkoutRes = await page.request.post(`${BASE}/api/billing/checkout`, {
      headers: {
        [headerName]: token,
        Origin: BASE,
        Referer: `${BASE}/facturation`,
      },
    });
    const checkoutJson = (await checkoutRes.json()) as {
      success: boolean;
      data?: { url?: string };
      error?: { message?: string };
    };
    if (!checkoutRes.ok() || !checkoutJson.success || !checkoutJson.data?.url) {
      throw new Error(
        `checkout ${checkoutRes.status()}: ${checkoutJson.error?.message || JSON.stringify(checkoutJson)}`,
      );
    }
    const checkoutUrl = checkoutJson.data.url;
    console.log("OK checkout session:", checkoutUrl.slice(0, 80) + "…");

    if (!checkoutUrl.includes("checkout.stripe.com")) {
      throw new Error("URL checkout inattendue");
    }

    console.log("\n=== Prod OK (quotas Free=20 + checkout Stripe créé) ===");
    console.log(
      "→ Ouvrez /facturation connecté et vérifiez « 10 €/mois » + paiement test carte 4242…",
    );
  } finally {
    await browser.close();
    await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
