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
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    o[k] = v;
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
  const id = process.argv[2];
  const r = id
    ? await c.query(`select * from public.app_analysis_jobs where id = $1`, [id])
    : await c.query(
        `select id, status, attempts, left(coalesce(last_error,''),160) as err,
                claimed_by, lease_expires_at, started_at, completed_at, created_at
         from public.app_analysis_jobs order by created_at desc limit 5`,
      );
  console.log(JSON.stringify(r.rows, null, 2));
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
