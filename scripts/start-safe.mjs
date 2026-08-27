/**
 * Démarre Next avec le même distDir que build-safe (hors Vercel: .next-build).
 */
import { spawnSync } from "node:child_process";

const isVercel = process.env.VERCEL === "1";
const distDir =
  process.env.DOCMIND_DIST_DIR || (isVercel ? ".next" : ".next-build");

const nextBin =
  process.platform === "win32"
    ? "node_modules\\next\\dist\\bin\\next"
    : "node_modules/next/dist/bin/next";

const args = [
  nextBin,
  "start",
  "-H",
  process.env.HOST || "127.0.0.1",
  "-p",
  process.env.PORT || "3000",
];

const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    DOCMIND_DIST_DIR: distDir,
    NODE_ENV: "production",
  },
});

process.exit(result.status ?? 1);
