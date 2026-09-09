/**
 * Applique 20260819000011_app_feedback.sql sur DATABASE_URL (.env.local).
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/apply-feedback-migration.ts
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

  const sql = readFileSync(
    path.join(root, "supabase/migrations/20260819000011_app_feedback.sql"),
    "utf8",
  );

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
    const check = await client.query<{ tbl: string | null; cnt: number }>(
      `select to_regclass('public.app_feedback') as tbl,
              (select count(*)::int from public.app_feedback) as cnt`,
    );
    console.log("Migration OK:", check.rows[0]);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
