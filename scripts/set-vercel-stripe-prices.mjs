/**
 * Pose les STRIPE_PRICE_* + QUOTA_FREE_ANALYZE sur Vercel Production
 * sans newline parasite (stdin = valeur exacte).
 * Usage: node scripts/set-vercel-stripe-prices.mjs
 */
import { spawnSync } from "node:child_process";
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
const prices = loadEnv(path.join(root, ".env.stripe-prices.local"));
const pairs = [
  ["STRIPE_PRICE_BASIQUE", prices.STRIPE_PRICE_BASIQUE],
  ["STRIPE_PRICE_PRO", prices.STRIPE_PRICE_PRO],
  ["STRIPE_PRICE_PREMIUM", prices.STRIPE_PRICE_PREMIUM],
  ["STRIPE_PRICE_EXTRA", prices.STRIPE_PRICE_EXTRA],
  ["QUOTA_FREE_ANALYZE", prices.QUOTA_FREE_ANALYZE || "5"],
];

for (const [name, value] of pairs) {
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  spawnSync("vercel", ["env", "rm", name, "production", "-y"], {
    stdio: "inherit",
    shell: true,
  });
  const add = spawnSync("vercel", ["env", "add", name, "production"], {
    input: value,
    encoding: "utf8",
    shell: true,
  });
  if (add.status !== 0) {
    console.error(name, add.stderr || add.stdout);
    process.exit(add.status || 1);
  }
  console.log(`OK ${name}`);
}
