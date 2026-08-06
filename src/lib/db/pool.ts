import { Pool, type QueryResultRow } from "pg";

import { chaosGate } from "@/lib/chaos";

type PoolGlobal = typeof globalThis & {
  __docmindPgPool?: Pool | null;
};

const g = globalThis as PoolGlobal;

export function getDatabaseUrl(): string | null {
  return process.env.DATABASE_URL?.trim() || null;
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
      ssl:
        process.env.PG_SSL === "0"
          ? undefined
          : { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== "0" },
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
