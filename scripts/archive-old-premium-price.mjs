/**
 * Remplace le default_price du produit de l'ancien Premium 10 €
 * par un price placeholder, puis archive le 10 €.
 */
import { readFileSync, existsSync } from "node:fs";
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
  ...loadEnv(path.join(root, ".env.stripe-prices.local")),
};
const key = env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY manquant");
  process.exit(1);
}

const oldPriceId = "price_1U6CAcIKoB72aP1G11JUpcgD";

const priceRes = await fetch(`https://api.stripe.com/v1/prices/${oldPriceId}`, {
  headers: { Authorization: `Bearer ${key}` },
});
const price = await priceRes.json();
if (price.error) {
  console.error(price.error.message);
  process.exit(1);
}
const productId =
  typeof price.product === "string" ? price.product : price.product?.id;
console.log({ oldPriceId, productId, amount: price.unit_amount, active: price.active });

if (!price.active || price.unit_amount !== 1000) {
  console.log("nothing to archive");
  process.exit(0);
}

// Price placeholder inactif à la vente (même produit) pour libérer default_price
const createBody = new URLSearchParams({
  product: productId,
  currency: "eur",
  unit_amount: "9999",
  "recurring[interval]": "month",
  nickname: "legacy-placeholder-do-not-sell",
});
const createRes = await fetch("https://api.stripe.com/v1/prices", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: createBody,
});
const placeholder = await createRes.json();
if (placeholder.error) {
  console.error("create placeholder:", placeholder.error.message);
  process.exit(1);
}
console.log("placeholder", placeholder.id);

const prodRes = await fetch(`https://api.stripe.com/v1/products/${productId}`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({ default_price: placeholder.id }).toString(),
});
const prod = await prodRes.json();
if (prod.error) {
  console.error("set default:", prod.error.message);
  process.exit(1);
}
console.log("default_price now", prod.default_price);

const archRes = await fetch(`https://api.stripe.com/v1/prices/${oldPriceId}`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: "active=false",
});
const archived = await archRes.json();
if (archived.error) {
  console.error("archive:", archived.error.message);
  process.exit(1);
}
console.log(`archived ${archived.id} active=${archived.active}`);

// Archive aussi le placeholder pour qu'il ne soit plus vendable.
const archPh = await fetch(`https://api.stripe.com/v1/prices/${placeholder.id}`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: "active=false",
});
const ph = await archPh.json();
console.log(`placeholder archived active=${ph.active} err=${ph.error?.message || "none"}`);
