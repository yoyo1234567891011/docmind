import { Pool, type QueryResultRow } from "pg";

import { chaosGate } from "@/lib/chaos";

type PoolGlobal = typeof globalThis & {
  __docmindPgPool?: Pool | null;
};

const g = globalThis as PoolGlobal;

export function getDatabaseUrl(): string | null {
  return process.env.DATABASE_URL?.trim() || null;
}

/**
 * SSL Postgres.
 * - PG_SSL=0 : pas de SSL (dev local rare)
 * - PG_SSL_REJECT_UNAUTHORIZED=0 : accepte cert self-signed (staging/local Supabase uniquement)
 * - En NEXT_PUBLIC_APP_ENV=production : rejectUnauthorized reste TOUJOURS true
 *   (aucun bypass TLS possible, même si la variable est définie).
 */
export function getPostgresSslOption():
  | undefined
  | { rejectUnauthorized: boolean } {
  if (process.env.PG_SSL === "0") return undefined;

  const appEnv = (
    process.env.NEXT_PUBLIC_APP_ENV ||
    process.env.NODE_ENV ||
    "development"
  ).toLowerCase();
  const relaxRequested =
    process.env.PG_SSL_REJECT_UNAUTHORIZED?.trim() === "0";

  if (appEnv === "production") {
    return { rejectUnauthorized: true };
  }

  return { rejectUnauthorized: !relaxRequested };
}

export function getPool(): Pool {
  const url = getDatabaseUrl();
  if (!url) {
    throw new Error("DATABASE_URL manquant.");
  }
  if (!g.__docmindPgPool) {
    g.__docmindPgPool = new Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      ssl: getPostgresSslOption(),
    });
  }
  return g.__docmindPgPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  await chaosGate("postgres_down");
  return getPool().query<T>(text, params);
}
