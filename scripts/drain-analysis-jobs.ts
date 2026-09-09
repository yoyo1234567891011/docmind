/**
 * Drain CLI — cron hôte (même modèle que monitor:check).
 *
 * Usage:
 *   npm run jobs:drain
 *   npm run jobs:drain -- --max 5
 *   npm run jobs:drain -- --via-http   # POST /api/cron/drain-analysis-jobs
 *   npm run jobs:drain:watch          # boucle locale toutes les 90s
 */
import { readFile } from "fs/promises";
import path from "path";

async function loadEnv() {
  // .env first (gaps only), then .env.local always wins — évite qu’un
  // DATABASE_URL périmé dans le shell (IPv6 db.*) écrase le pooler du fichier.
  for (const fileName of [".env", ".env.local"] as const) {
    try {
      const content = await readFile(path.join(process.cwd(), fileName), "utf8");
      for (const line of content.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq <= 0) continue;
        const key = t.slice(0, eq).trim();
        let value = t.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (fileName === ".env.local" || process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    } catch {
      // optional
    }
  }
}

function parseArgs(argv: string[]) {
  let maxJobs = 3;
  let viaHttp = false;
  let watch = false;
  /** Intervalle watch (ms) — défaut 90s (bêta : 1–2 min). */
  let intervalMs = 90_000;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--max") maxJobs = Math.max(1, Number(argv[++i]) || 3);
    else if (a === "--via-http") viaHttp = true;
    else if (a === "--watch") watch = true;
    else if (a === "--interval") {
      const sec = Number(argv[++i]);
      if (Number.isFinite(sec) && sec >= 15) intervalMs = Math.floor(sec * 1000);
    }
  }
  return { maxJobs, viaHttp, watch, intervalMs };
}

async function drainOnce(opts: {
  maxJobs: number;
  viaHttp: boolean;
}): Promise<void> {
  const { maxJobs, viaHttp } = opts;

  if (viaHttp) {
    const base =
      process.env.EVAL_BASE_URL?.replace(/\/$/, "") ||
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
      "http://127.0.0.1:3000";
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret) {
      throw new Error(
        "CRON_SECRET manquant dans .env.local — requis pour --via-http / cron HTTP.",
      );
    }
    const res = await fetch(`${base}/api/cron/drain-analysis-jobs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ maxJobs }),
    });
    const json = (await res.json()) as unknown;
    console.log(
      JSON.stringify(
        { at: new Date().toISOString(), httpStatus: res.status, body: json },
        null,
        2,
      ),
    );
    if (!res.ok) throw new Error(`drain HTTP ${res.status}`);
    return;
  }

  const { drainAnalysisJobs, getAnalysisJobStats } = await import(
    "../src/services/analysis-jobs"
  );
  const before = await getAnalysisJobStats();
  const processed = await drainAnalysisJobs(maxJobs);
  const after = await getAnalysisJobStats();
  console.log(
    JSON.stringify(
      { at: new Date().toISOString(), processed, maxJobs, before, after },
      null,
      2,
    ),
  );
}

async function main() {
  await loadEnv();
  const { maxJobs, viaHttp, watch, intervalMs } = parseArgs(
    process.argv.slice(2),
  );

  if (!watch) {
    await drainOnce({ maxJobs, viaHttp });
    return;
  }

  console.log(
    `[jobs:drain:watch] interval=${intervalMs}ms maxJobs=${maxJobs} viaHttp=${viaHttp}`,
  );
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await drainOnce({ maxJobs, viaHttp });
    } catch (error) {
      console.error(
        "[jobs:drain:watch] erreur (réessai au prochain tick)",
        error instanceof Error ? error.message : error,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
