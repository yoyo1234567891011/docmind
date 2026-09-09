/**
 * Crash recovery sur staging PG (DATABASE_URL) — sans Ollama.
 * Claim → abandon → expire lease SQL → reclaim → complete stub.
 */
import { readFileSync, existsSync } from "fs";
import path from "path";
import pg from "pg";
import { randomUUID } from "crypto";

function loadEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  const env = {
    ...loadEnvFile(path.join(process.cwd(), ".env")),
    ...loadEnvFile(path.join(process.cwd(), ".env.local")),
  };
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL manquant");

  process.env.DOCMIND_STORAGE = "persistent";
  process.env.DATABASE_URL = databaseUrl;
  process.env.PG_SSL_REJECT_UNAUTHORIZED =
    process.env.PG_SSL_REJECT_UNAUTHORIZED || "0";

  const ssl =
    databaseUrl.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false };
  const client = new pg.Client({ connectionString: databaseUrl, ssl });
  await client.connect();

  const id = `crash-pg-${randomUUID()}`;
  const userId = `crash-pg-user`;
  const documentId = `crash-pg-doc-${randomUUID().slice(0, 8)}`;
  const historyId = `crash-pg-hist-${randomUUID().slice(0, 8)}`;

  await client.query(
    `insert into public.app_analysis_jobs
      (id, user_id, document_id, history_id, file_name, status)
     values ($1,$2,$3,$4,'crash.pdf','pending')`,
    [id, userId, documentId, historyId],
  );

  // Import après env pour utiliser le pool DocMind
  const {
    claimNextAnalysisJob,
    completeAnalysisJob,
    getAnalysisJob,
  } = await import("../src/services/analysis-jobs");

  const a = await claimNextAnalysisJob("pg-worker-a");
  assert(a?.id === id || a?.documentId === documentId, "claim A");
  const jobId = a!.id;

  const b = await claimNextAnalysisJob("pg-worker-b");
  assert(b === null || b.id !== jobId, "pas de double claim sous lease");

  // Expire lease forcée (crash)
  await client.query(
    `update public.app_analysis_jobs
     set lease_expires_at = timezone('utc', now()) - interval '1 second'
     where id = $1`,
    [jobId],
  );

  const [c1, c2] = await Promise.all([
    claimNextAnalysisJob("pg-w1"),
    claimNextAnalysisJob("pg-w2"),
  ]);
  const winners = [c1, c2].filter((j) => j && j.id === jobId);
  assert(winners.length === 1, `1 reclaim winner, got ${winners.length}`);

  await completeAnalysisJob(jobId, {
    queueWaitMs: 5,
    lockWaitMs: 0,
    generateMs: 0,
    historyMs: 0,
    memoryMs: null,
    totalMs: 5,
  });

  const done = await getAnalysisJob(jobId, userId);
  assert(done?.status === "completed", "completed");
  assert(done?.metrics?.queueWaitMs === 5, "metrics");

  const again = await claimNextAnalysisJob("pg-w3");
  assert(!again || again.id !== jobId, "completed non reclaimable");

  // Cleanup
  await client.query(`delete from public.app_analysis_jobs where id = $1`, [
    jobId,
  ]);
  await client.end();

  console.log("OK crash-recovery staging PG (lease expire + single reclaim)");
}

main().catch((e) => {
  console.error("FAIL", e instanceof Error ? e.message : e);
  process.exit(1);
});
