/**
 * Build production sans race sur le dossier .next de `next dev`.
 *
 * - Local / CI hors Vercel : distDir = .next-build (isolé de npm run dev)
 * - Vercel : distDir = .next (convention plateforme)
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const isVercel = process.env.VERCEL === "1";
const distDir =
  process.env.DOCMIND_DIST_DIR || (isVercel ? ".next" : ".next-build");
const lockPath = path.join(ROOT, `${distDir}.build.lock`);

function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock() {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  if (existsSync(lockPath)) {
    const prev = Number(readFileSync(lockPath, "utf8").trim());
    if (isPidAlive(prev)) {
      console.error(
        `[docmind:build] Un autre build utilise déjà ${distDir} (pid=${prev}).`,
      );
      process.exit(1);
    }
  }
  writeFileSync(lockPath, String(process.pid), "utf8");
}

function releaseLock() {
  try {
    unlinkSync(lockPath);
  } catch {
    // ignore
  }
}

acquireLock();
console.log(`[docmind:build] distDir=${distDir}`);

const nextBin =
  process.platform === "win32"
    ? "node_modules\\next\\dist\\bin\\next"
    : "node_modules/next/dist/bin/next";

const result = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    DOCMIND_DIST_DIR: distDir,
    NODE_ENV: "production",
  },
});

releaseLock();
process.exit(result.status ?? 1);
