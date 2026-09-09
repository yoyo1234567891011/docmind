/**
 * Applique 20260814000009 (+ metrics 00010 si présent) sur DATABASE_URL
 * (.env.local) puis vérifie structure / index / RLS.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/apply-analysis-jobs-migration.ts
 */
import { readFileSync, existsSync } from "fs";
import path from "path";
import pg from "pg";

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

async function main() {
  const root = process.cwd();
  const env = {
    ...loadEnvFile(path.join(root, ".env")),
    ...loadEnvFile(path.join(root, ".env.local")),
  };
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL manquant (.env.local)");
  }

  console.log(
    "TARGET",
    JSON.stringify({
      storage: env.DOCMIND_STORAGE ?? null,
      appEnv: env.NEXT_PUBLIC_APP_ENV ?? env.APP_ENV ?? null,
      urlHost: (() => {
        try {
          return new URL(databaseUrl).host;
        } catch {
          return "<unparseable>";
        }
      })(),
    }),
  );

  const pgSsl = (env.PG_SSL ?? process.env.PG_SSL)?.trim();
  const rejectUnauth = (
    env.PG_SSL_REJECT_UNAUTHORIZED ?? process.env.PG_SSL_REJECT_UNAUTHORIZED
  )?.trim();
  const appEnv = (
    env.NEXT_PUBLIC_APP_ENV ??
    env.APP_ENV ??
    process.env.NEXT_PUBLIC_APP_ENV ??
    ""
  ).toLowerCase();
  const ssl =
    pgSsl === "0" || databaseUrl.includes("localhost")
      ? undefined
      : {
          rejectUnauthorized:
            appEnv === "production" ? true : rejectUnauth !== "0",
        };

  console.log(
    "SSL",
    JSON.stringify({
      mode: ssl === undefined ? "off" : "on",
      rejectUnauthorized: ssl?.rejectUnauthorized ?? null,
      appEnv: appEnv || null,
    }),
  );

  const client = new pg.Client({ connectionString: databaseUrl, ssl });
  await client.connect();

  const who = await client.query<{
    db: string;
    usr: string;
    host: string | null;
  }>(
    `select current_database() as db, current_user as usr, inet_server_addr()::text as host`,
  );
  console.log("CONNECTED", JSON.stringify(who.rows[0]));

  const migrations = [
    "20260814000009_app_analysis_jobs.sql",
    "20260814000010_app_analysis_jobs_metrics.sql",
  ];
  for (const name of migrations) {
    const sqlPath = path.join(root, "supabase/migrations", name);
    if (!existsSync(sqlPath)) {
      console.log("SKIP_MISSING", name);
      continue;
    }
    await client.query(readFileSync(sqlPath, "utf8"));
    console.log("MIGRATION_APPLIED", name);
  }

  const cols = await client.query<{
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>(
    `select column_name, data_type, is_nullable
     from information_schema.columns
     where table_schema = 'public' and table_name = 'app_analysis_jobs'
     order by ordinal_position`,
  );
  console.log(
    "COLUMNS",
    cols.rows
      .map(
        (r) =>
          `${r.column_name}:${r.data_type}${r.is_nullable === "NO" ? "!" : ""}`,
      )
      .join(", "),
  );

  const cons = await client.query<{ conname: string; def: string }>(
    `select conname, pg_get_constraintdef(oid) as def
     from pg_constraint
     where conrelid = 'public.app_analysis_jobs'::regclass
     order by conname`,
  );
  console.log("CONSTRAINTS");
  for (const row of cons.rows) console.log(` - ${row.conname}: ${row.def}`);

  const idxs = await client.query<{ indexname: string; indexdef: string }>(
    `select indexname, indexdef from pg_indexes
     where schemaname = 'public' and tablename = 'app_analysis_jobs'
     order by indexname`,
  );
  console.log("INDEXES");
  for (const row of idxs.rows)
    console.log(` - ${row.indexname}: ${row.indexdef}`);

  const rls = await client.query<{ rls: boolean; force_rls: boolean }>(
    `select c.relrowsecurity as rls, c.relforcerowsecurity as force_rls
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'app_analysis_jobs'`,
  );
  console.log("RLS", JSON.stringify(rls.rows[0] ?? null));

  const policies = await client.query(
    `select policyname from pg_policies
     where schemaname = 'public' and tablename = 'app_analysis_jobs'`,
  );
  console.log("POLICIES_COUNT", policies.rowCount);
  console.log(
    "HAS_METRICS_COLUMN",
    cols.rows.some((c) => c.column_name === "metrics"),
  );

  const smokeId = `migrate-smoke-${Date.now()}`;
  await client.query(
    `insert into public.app_analysis_jobs
      (id, user_id, document_id, history_id, file_name, status)
     values ($1, $2, $3, $4, $5, 'pending')`,
    [smokeId, "smoke-user", "smoke-doc", "smoke-hist", "smoke.pdf"],
  );
  const active = await client.query(
    `select id from public.app_analysis_jobs
     where user_id = $1 and document_id = $2 and status in ('pending','processing')`,
    ["smoke-user", "smoke-doc"],
  );
  console.log("SMOKE_ACTIVE", active.rowCount);
  await client.query(`delete from public.app_analysis_jobs where id = $1`, [
    smokeId,
  ]);
  console.log("SMOKE_CLEANED");

  await client.end();
  console.log("OK");
}

main().catch((error) => {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
});
