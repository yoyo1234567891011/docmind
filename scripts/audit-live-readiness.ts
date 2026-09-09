/**
 * Audit readiness Stripe Live — sortie sans secrets.
 * Usage: npx tsx --tsconfig tsconfig.json scripts/audit-live-readiness.ts
 */
import { loadEnvFiles } from "./lib/load-env-files";
import { BILLING_PLANS } from "../src/config/billing";
import { areStripePaidPricesConfigured } from "../src/config/billing";
import { isStripeConfigured, isStripeLiveMode } from "../src/lib/stripe";

loadEnvFiles(process.cwd(), { override: false });
loadEnvFiles(process.cwd(), { override: true, files: [".env.cloud-beta.local"] });
loadEnvFiles(process.cwd(), { override: true, files: [".env.stripe-prices.local"] });

function keyMode(name: string): "ABSENT" | "TEST" | "LIVE" | "MISMATCH" | "UNKNOWN" {
  const v = process.env[name]?.trim() ?? "";
  if (!v) return "ABSENT";
  if (v.startsWith("sk_live_") || v.startsWith("pk_live_")) return "LIVE";
  if (v.startsWith("sk_test_") || v.startsWith("pk_test_")) return "TEST";
  return "UNKNOWN";
}

async function verifyPrices(mode: "TEST" | "LIVE") {
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const plans = ["basique", "pro", "premium", "extra"] as const;
  const envKeys = {
    basique: "STRIPE_PRICE_BASIQUE",
    pro: "STRIPE_PRICE_PRO",
    premium: "STRIPE_PRICE_PREMIUM",
    extra: "STRIPE_PRICE_EXTRA",
  } as const;
  const out: Record<string, string> = {};
  for (const plan of plans) {
    const id = process.env[envKeys[plan]]?.trim();
    const expected = BILLING_PLANS[plan].priceMonthlyEur;
    if (!id) {
      out[plan] = "ABSENT";
      continue;
    }
    try {
      const p = await stripe.prices.retrieve(id);
      const eur = (p.unit_amount ?? 0) / 100;
      const ok =
        p.active &&
        p.currency === "eur" &&
        p.recurring?.interval === "month" &&
        eur === expected;
      out[plan] = ok
        ? `OK ${eur} EUR (${mode})`
        : `KO eur=${eur} expected=${expected} active=${p.active}`;
    } catch (e) {
      out[plan] = `ERR ${e instanceof Error ? e.message.slice(0, 60) : e}`;
    }
  }
  return out;
}

async function main() {
  const sk = keyMode("STRIPE_SECRET_KEY");
  const pk = keyMode("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
  const pairOk =
    (sk === "TEST" && pk === "TEST") ||
    (sk === "LIVE" && pk === "LIVE") ||
    sk === "ABSENT" ||
    pk === "ABSENT"
      ? sk === pk || sk === "ABSENT"
      : false;

  console.log("=== CONFIG ACTUELLE (sans secrets) ===");
  console.log(
    JSON.stringify(
      {
        NEXT_PUBLIC_APP_ENV:
          process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV ?? "(unset)",
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "(unset)",
        NODE_ENV: process.env.NODE_ENV ?? "(unset)",
        STRIPE_SECRET_KEY: sk,
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: pk,
        sk_pk_coherent: pairOk,
        STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET?.trim()
          ? "SET"
          : "ABSENT",
        STRIPE_PRICE_BASIQUE: process.env.STRIPE_PRICE_BASIQUE?.trim()
          ? "SET"
          : "ABSENT",
        STRIPE_PRICE_PRO: process.env.STRIPE_PRICE_PRO?.trim() ? "SET" : "ABSENT",
        STRIPE_PRICE_PREMIUM: process.env.STRIPE_PRICE_PREMIUM?.trim()
          ? "SET"
          : "ABSENT",
        STRIPE_PRICE_EXTRA: process.env.STRIPE_PRICE_EXTRA?.trim()
          ? "SET"
          : "ABSENT",
        allFourPrices: areStripePaidPricesConfigured(),
        isStripeConfigured: isStripeConfigured(),
        isStripeLiveMode: isStripeConfigured() ? isStripeLiveMode() : null,
        BILLING_ENTITLEMENTS_FAIL_OPEN:
          process.env.BILLING_ENTITLEMENTS_FAIL_OPEN ?? "(unset)",
        DOCMIND_STORAGE: process.env.DOCMIND_STORAGE ?? "(unset)",
        DATABASE_URL: process.env.DATABASE_URL?.trim() ? "SET" : "ABSENT",
        REDIS_URL: process.env.REDIS_URL?.trim() ? "SET" : "ABSENT",
        S3_BUCKET: process.env.S3_BUCKET?.trim() ? "SET" : "ABSENT",
        CRON_SECRET: process.env.CRON_SECRET?.trim() ? "SET" : "ABSENT",
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
          ? "SET"
          : "ABSENT",
        webhookEndpoint: `${(process.env.NEXT_PUBLIC_APP_URL ?? "https://docmind-blond.vercel.app").replace(/\/$/, "")}/api/stripe/webhook`,
      },
      null,
      2,
    ),
  );

  if (sk === "TEST" && isStripeConfigured()) {
    console.log("\n=== PRIX STRIPE TEST (API) ===");
    console.log(JSON.stringify(await verifyPrices("TEST"), null, 2));
  } else if (sk === "LIVE" && isStripeConfigured()) {
    console.log("\n=== PRIX STRIPE LIVE (API) ===");
    console.log(JSON.stringify(await verifyPrices("LIVE"), null, 2));
  } else {
    console.log("\n=== PRIX STRIPE === skip (clé absente ou inconnue)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
