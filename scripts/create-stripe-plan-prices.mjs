/**
 * Crée / réutilise les 4 prices mensuels EUR sous les Products DocMind.
 * Usage: node scripts/create-stripe-plan-prices.mjs
 * Lit STRIPE_SECRET_KEY depuis .env.cloud-beta.local puis .env.local.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";

function loadEnv(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

const root = process.cwd();
const env = {
  ...loadEnv(path.join(root, ".env.local")),
  ...loadEnv(path.join(root, ".env.cloud-beta.local")),
};
const key = env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY manquant");
  process.exit(1);
}

const mode = key.startsWith("sk_live")
  ? "live"
  : key.startsWith("sk_test")
    ? "test"
    : "unknown";
console.log(`MODE=${mode}`);

const products = {
  basique: { id: "prod_V8lTDxUH4uqxZa", amount: 999 },
  pro: { id: "prod_V8lVpPlueoZdlH", amount: 1999 },
  premium: { id: "prod_V8lVqo8YOqgVc7", amount: 3499 },
  extra: { id: "prod_V8lWHk7jDGuHqN", amount: 5999 },
};

async function listPrices(productId) {
  const u = new URL("https://api.stripe.com/v1/prices");
  u.searchParams.set("product", productId);
  u.searchParams.set("active", "true");
  u.searchParams.set("limit", "20");
  const r = await fetch(u, { headers: { Authorization: `Bearer ${key}` } });
  const j = await r.json();
  if (j.error) throw new Error(`${productId}: ${j.error.message}`);
  return j.data || [];
}

async function createPrice(productId, amount, nickname) {
  const body = new URLSearchParams({
    product: productId,
    currency: "eur",
    unit_amount: String(amount),
    "recurring[interval]": "month",
    nickname,
  });
  const r = await fetch("https://api.stripe.com/v1/prices", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const j = await r.json();
  if (j.error) throw new Error(`${nickname}: ${j.error.message}`);
  return j;
}

const out = {};
for (const [plan, meta] of Object.entries(products)) {
  const existing = await listPrices(meta.id);
  const match = existing.find(
    (p) =>
      p.currency === "eur" &&
      p.unit_amount === meta.amount &&
      p.recurring?.interval === "month",
  );
  if (match) {
    out[plan] = { priceId: match.id, created: false, amount: meta.amount };
  } else {
    const p = await createPrice(
      meta.id,
      meta.amount,
      `DocMind ${plan} monthly`,
    );
    out[plan] = { priceId: p.id, created: true, amount: meta.amount };
  }
}

console.log(JSON.stringify(out, null, 2));

const snippet = [
  `STRIPE_PRICE_BASIQUE=${out.basique.priceId}`,
  `STRIPE_PRICE_PRO=${out.pro.priceId}`,
  `STRIPE_PRICE_PREMIUM=${out.premium.priceId}`,
  `STRIPE_PRICE_EXTRA=${out.extra.priceId}`,
  "QUOTA_FREE_ANALYZE=5",
].join("\n");

const outPath = path.join(root, ".env.stripe-prices.local");
writeFileSync(outPath, snippet + "\n", "utf8");
console.log(`WROTE ${outPath}`);
