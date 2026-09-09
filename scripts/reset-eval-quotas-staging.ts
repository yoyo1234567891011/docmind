/**
 * Reset staging usage for eval-runner (ops load only — pas un changement métier).
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
  const env = {
    ...loadEnvFile(path.join(process.cwd(), ".env")),
    ...loadEnvFile(path.join(process.cwd(), ".env.local")),
  };
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL manquant");
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });
  await client.connect();
  const before = await client.query(
    `select user_id, month, data from public.app_usage
     where user_id = 'eval-runner' or user_id like 'eval-runner%'
     order by month desc`,
  );
  console.log("before", JSON.stringify(before.rows, null, 2));
  const del = await client.query(
    `delete from public.app_usage
     where user_id = 'eval-runner' or user_id like 'eval-runner%'`,
  );
  console.log("deleted", del.rowCount);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
