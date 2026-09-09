/**
 * Applique 20260901000013_drop_subscriptions_update_own.sql sur DATABASE_URL.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/apply-drop-subscriptions-update-own.ts
 */
import { readFileSync } from "fs";
import path from "path";
import pg from "pg";

import { loadEnvFiles } from "./lib/load-env-files";

loadEnvFiles(process.cwd(), { override: true });
loadEnvFiles(process.cwd(), {
  override: true,
  files: [".env.cloud-beta.local", ".env.local"],
});

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL manquant (.env.local)");
  }

  const sql = readFileSync(
    path.join(
      process.cwd(),
      "supabase/migrations/20260901000013_drop_subscriptions_update_own.sql",
    ),
    "utf8",
  );

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const before = await client.query<{ policyname: string }>(
      `select policyname
       from pg_policies
       where schemaname = 'public' and tablename = 'subscriptions'
       order by policyname`,
    );
    console.log(
      "AVANT:",
      before.rows.map((r) => r.policyname).join(", ") || "(aucune)",
    );

    await client.query(sql);

    const after = await client.query<{ policyname: string; cmd: string }>(
      `select policyname, cmd
       from pg_policies
       where schemaname = 'public' and tablename = 'subscriptions'
       order by policyname`,
    );
    console.log("APRES:", JSON.stringify(after.rows, null, 2));

    const hasUpdate = after.rows.some(
      (r) => r.policyname === "subscriptions_update_own",
    );
    if (hasUpdate) {
      throw new Error("ECHEC: subscriptions_update_own encore présente");
    }
    console.log("Migration 20260901000013 OK");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
