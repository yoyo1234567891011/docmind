import { readFileSync, existsSync } from "fs";
import pg from "pg";

function load(p: string) {
  if (!existsSync(p)) return {} as Record<string, string>;
  const o: Record<string, string> = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    o[t.slice(0, i).trim()] = v;
  }
  return o;
}

async function main() {
  const env = { ...load(".env"), ...load(".env.local") };
  const c = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  const stuck = await c.query(`
    select id, status, attempts, last_error, metrics,
           claimed_by, lease_expires_at, started_at, completed_at, created_at,
           round(extract(epoch from (coalesce(completed_at, now()) - coalesce(started_at, created_at)))::numeric, 1) as dur_s,
           file_name
    from public.app_analysis_jobs
    where status in ('pending','processing','failed')
       or attempts > 1
       or last_error is not null
    order by created_at desc limit 15`);

  const recent = await c.query(`
    select id, status, attempts, left(coalesce(last_error,''),200) as err,
           metrics->>'totalTokens' as tokens,
           metrics->>'generateMs' as gen_ms,
           metrics->>'lockWaitMs' as lock_ms,
           metrics->>'totalMs' as total_ms,
           round(extract(epoch from (coalesce(completed_at, now()) - coalesce(started_at, created_at)))::numeric, 1) as dur_s,
           file_name, created_at
    from public.app_analysis_jobs
    order by created_at desc limit 10`);

  console.log("=== STUCK / RETRY / FAILED ===");
  console.log(JSON.stringify(stuck.rows, null, 2));
  console.log("\n=== RECENT (metrics) ===");
  console.log(JSON.stringify(recent.rows, null, 2));
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
