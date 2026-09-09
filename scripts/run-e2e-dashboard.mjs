/**
 * Lance les E2E Dashboard avec E2E_TARGET=local|staging.
 * Usage: node scripts/run-e2e-dashboard.mjs staging
 */
import { spawnSync } from "child_process";

const target = (process.argv[2] || "local").toLowerCase();
if (target !== "local" && target !== "staging") {
  console.error("Usage: node scripts/run-e2e-dashboard.mjs [local|staging]");
  process.exit(1);
}

process.env.E2E_TARGET = target;

const prepare = spawnSync("npm", ["run", "e2e:prepare"], {
  stdio: "inherit",
  shell: true,
  env: process.env,
});
if (prepare.status !== 0) process.exit(prepare.status ?? 1);

const test = spawnSync(
  "npx",
  ["playwright", "test", "e2e/specs/07-dashboard-e2e.spec.ts"],
  {
    stdio: "inherit",
    shell: true,
    env: process.env,
  },
);
process.exit(test.status ?? 1);
