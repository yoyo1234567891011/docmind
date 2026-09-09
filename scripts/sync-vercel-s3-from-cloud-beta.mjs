/**
 * Resync S3_* Production depuis .env.cloud-beta.local (credentials qui marchent).
 * Usage: node scripts/sync-vercel-s3-from-cloud-beta.mjs
 */
import { readFileSync, existsSync } from "node:fs";
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

const root = process.cwd();
const env = {
  ...loadEnv(path.join(root, ".env.local")),
  ...loadEnv(path.join(root, ".env.cloud-beta.local")),
};

const keys = [
  "S3_BUCKET",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_FORCE_PATH_STYLE",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_SESSION_TOKEN",
];

for (const name of keys) {
  const value = env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name} in cloud-beta/local`);
    process.exit(1);
  }
  spawnSync("vercel", ["env", "rm", name, "production", "-y"], {
    stdio: "inherit",
    shell: true,
    cwd: root,
  });
  const add = spawnSync("vercel", ["env", "add", name, "production"], {
    input: value,
    encoding: "utf8",
    shell: true,
    cwd: root,
  });
  if (add.status !== 0) {
    console.error(name, add.stderr || add.stdout);
    process.exit(add.status || 1);
  }
  console.log(`OK ${name} (len=${value.length})`);
}
