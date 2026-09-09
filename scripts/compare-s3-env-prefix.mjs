/**
 * Compare S3 env local/cloud-beta vs Vercel production (préfixes seulement).
 * Usage: node scripts/compare-s3-env-prefix.mjs
 */
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

function loadEnv(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

function prefix(v) {
  if (!v) return null;
  return {
    len: v.length,
    prefix: v.slice(0, 8),
    suffix: v.slice(-4),
  };
}

const root = process.cwd();
const local = {
  ...loadEnv(path.join(root, ".env.local")),
  ...loadEnv(path.join(root, ".env.cloud-beta.local")),
};

const pull = spawnSync(
  "vercel",
  ["env", "pull", ".env.vercel.s3cmp.tmp", "--environment", "production", "--yes"],
  { encoding: "utf8", shell: true, cwd: root },
);
if (pull.status !== 0) {
  console.error(pull.stderr || pull.stdout);
  process.exit(1);
}
const prod = loadEnv(path.join(root, ".env.vercel.s3cmp.tmp"));
try {
  unlinkSync(path.join(root, ".env.vercel.s3cmp.tmp"));
} catch {
  /* ignore */
}

const keys = [
  "DOCMIND_STORAGE",
  "S3_BUCKET",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_FORCE_PATH_STYLE",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_SESSION_TOKEN",
];

for (const k of keys) {
  const L = local[k]?.trim() || "";
  const P = (prod[k] || "").replace(/^"|"$/g, "").trim();
  const same = L === P;
  console.log(
    JSON.stringify({
      key: k,
      same: k.startsWith("S3_") && (k.includes("SECRET") || k.includes("TOKEN") || k.includes("KEY"))
        ? same
        : L === P,
      local: k.includes("SECRET") || k.includes("TOKEN") || k.includes("KEY")
        ? prefix(L)
        : L || null,
      prod: k.includes("SECRET") || k.includes("TOKEN") || k.includes("KEY")
        ? prefix(P)
        : P || null,
    }),
  );
}
