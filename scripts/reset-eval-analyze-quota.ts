/**
 * Reset usage analyze for eval-runner — ops staging only (pas un changement de règle métier).
 */
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
  const before = await c.query(
    `select user_id, metric, period, used from public.app_usage
     where user_id like 'eval-runner%' and metric = 'analyze'
     order by period desc limit 10`,
  );
  console.log("BEFORE", JSON.stringify(before.rows));
  const upd = await c.query(
    `update public.app_usage set used = 0
     where user_id like 'eval-runner%' and metric = 'analyze'
     returning user_id, metric, period, used`,
  );
  console.log("RESET", upd.rowCount, JSON.stringify(upd.rows));
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
