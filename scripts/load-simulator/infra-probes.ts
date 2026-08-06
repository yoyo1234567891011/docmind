/**
 * Probes latence Redis / Postgres / S3 (indépendants de l’app).
 * Mesure PING / SELECT 1 / HeadBucket — pas de charge applicative.
 */

import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import Redis from "ioredis";
import { Pool } from "pg";

import { avg, emptyInfraSummary, percentile } from "./stats";
import type { InfraProbeSample, InfraProbeSummary } from "./types";

let redis: Redis | null | undefined;
let pool: Pool | null | undefined;
let s3: S3Client | null | undefined;
let s3Bucket: string | null | undefined;

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    redis = null;
    return null;
  }
  try {
    redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 3_000,
      commandTimeout: 3_000,
    });
    return redis;
  } catch {
    redis = null;
    return null;
  }
}

function getPg(): Pool | null {
  if (pool !== undefined) return pool;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    pool = null;
    return null;
  }
  pool = new Pool({
    connectionString: url,
    max: 4,
    connectionTimeoutMillis: 3_000,
    ssl:
      process.env.PG_SSL === "0"
        ? undefined
        : { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== "0" },
  });
  return pool;
}

function getS3(): { client: S3Client; bucket: string } | null {
  if (s3 !== undefined) {
    return s3 && s3Bucket ? { client: s3, bucket: s3Bucket } : null;
  }
  const bucket = process.env.S3_BUCKET?.trim();
  const key = process.env.S3_ACCESS_KEY_ID?.trim();
  const secret = process.env.S3_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !key || !secret) {
    s3 = null;
    s3Bucket = null;
    return null;
  }
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const region =
    process.env.S3_REGION?.trim() ||
    process.env.AWS_REGION?.trim() ||
    "auto";
  s3 = new S3Client({
    region,
    endpoint: endpoint || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "0",
    credentials: { accessKeyId: key, secretAccessKey: secret },
  });
  s3Bucket = bucket;
  return { client: s3, bucket };
}

async function timed<T>(
  fn: () => Promise<T>,
): Promise<{ ms: number; ok: boolean }> {
  const t0 = Date.now();
  try {
    await fn();
    return { ms: Date.now() - t0, ok: true };
  } catch {
    return { ms: Date.now() - t0, ok: false };
  }
}

export async function sampleInfraOnce(): Promise<InfraProbeSample> {
  const sample: InfraProbeSample = {
    at: new Date().toISOString(),
    redisMs: null,
    redisOk: null,
    postgresMs: null,
    postgresOk: null,
    s3Ms: null,
    s3Ok: null,
  };

  const r = getRedis();
  if (r) {
    try {
      if (r.status !== "ready") await r.connect().catch(() => undefined);
      const res = await timed(() => r.ping());
      sample.redisMs = res.ms;
      sample.redisOk = res.ok;
    } catch {
      sample.redisOk = false;
      sample.redisMs = null;
    }
  }

  const pg = getPg();
  if (pg) {
    const res = await timed(() => pg.query("SELECT 1"));
    sample.postgresMs = res.ms;
    sample.postgresOk = res.ok;
  }

  const s3cfg = getS3();
  if (s3cfg) {
    const res = await timed(() =>
      s3cfg.client.send(new HeadBucketCommand({ Bucket: s3cfg.bucket })),
    );
    sample.s3Ms = res.ms;
    sample.s3Ok = res.ok;
  }

  return sample;
}

/**
 * Rafale de probes en parallèle (mesure sous contention).
 * concurrency plafonnée pour ne pas saturer la machine de test.
 */
export async function probeInfraBurst(
  concurrency: number,
): Promise<InfraProbeSample[]> {
  const n = Math.max(1, Math.min(concurrency, 64));
  const tasks = Array.from({ length: n }, () => sampleInfraOnce());
  return Promise.all(tasks);
}

function summarizeChannel(
  values: Array<number | null>,
  oks: Array<boolean | null>,
  configured: boolean,
  note?: string,
): InfraProbeSummary {
  if (!configured) {
    return emptyInfraSummary(note ?? "Non configuré (env absente)");
  }
  const ms = values.filter((v): v is number => typeof v === "number");
  const okFlags = oks.filter((v): v is boolean => typeof v === "boolean");
  const okCount = okFlags.filter(Boolean).length;
  return {
    configured: true,
    samples: values.length,
    okRate: okFlags.length === 0 ? 0 : okCount / okFlags.length,
    avgMs: ms.length ? avg(ms) : null,
    p50Ms: ms.length ? percentile(ms, 50) : null,
    p95Ms: ms.length ? percentile(ms, 95) : null,
    p99Ms: ms.length ? percentile(ms, 99) : null,
    maxMs: ms.length ? Math.max(...ms) : null,
    note,
  };
}

export function summarizeInfraSamples(samples: InfraProbeSample[]): {
  redis: InfraProbeSummary;
  postgres: InfraProbeSummary;
  s3: InfraProbeSummary;
} {
  const redisConfigured = Boolean(process.env.REDIS_URL?.trim());
  const pgConfigured = Boolean(process.env.DATABASE_URL?.trim());
  const s3Configured = Boolean(
    process.env.S3_BUCKET?.trim() &&
      process.env.S3_ACCESS_KEY_ID?.trim() &&
      process.env.S3_SECRET_ACCESS_KEY?.trim(),
  );

  return {
    redis: summarizeChannel(
      samples.map((s) => s.redisMs),
      samples.map((s) => s.redisOk),
      redisConfigured,
    ),
    postgres: summarizeChannel(
      samples.map((s) => s.postgresMs),
      samples.map((s) => s.postgresOk),
      pgConfigured,
    ),
    s3: summarizeChannel(
      samples.map((s) => s.s3Ms),
      samples.map((s) => s.s3Ok),
      s3Configured,
    ),
  };
}

/** Projection légère de latence infra sous charge (modèle). */
export function projectInfraUnderLoad(
  baseline: {
    redis: InfraProbeSummary;
    postgres: InfraProbeSummary;
    s3: InfraProbeSummary;
  },
  concurrentUsers: number,
): {
  redis: InfraProbeSummary;
  postgres: InfraProbeSummary;
  s3: InfraProbeSummary;
} {
  // Contention approximative : +0.5 % par user au-delà de 100, plafonné ×8
  const factor = Math.min(8, 1 + Math.max(0, concurrentUsers - 100) * 0.005);

  const scale = (s: InfraProbeSummary, label: string): InfraProbeSummary => {
    if (!s.configured || s.avgMs == null) {
      return {
        ...s,
        note: s.note ?? `${label}: baseline indisponible — projection N/A`,
      };
    }
    const mul = (v: number | null) =>
      v == null ? null : Math.round(v * factor);
    return {
      ...s,
      avgMs: mul(s.avgMs),
      p50Ms: mul(s.p50Ms),
      p95Ms: mul(s.p95Ms),
      p99Ms: mul(s.p99Ms),
      maxMs: mul(s.maxMs),
      note: `${label}: projection ×${factor.toFixed(2)} vs baseline (modèle)`,
    };
  };

  return {
    redis: scale(baseline.redis, "Redis"),
    postgres: scale(baseline.postgres, "Postgres"),
    s3: scale(baseline.s3, "S3"),
  };
}

export async function closeInfraClients(): Promise<void> {
  if (redis) {
    try {
      redis.disconnect();
    } catch {
      // ignore
    }
  }
  redis = undefined;
  if (pool) {
    try {
      await pool.end();
    } catch {
      // ignore
    }
  }
  pool = undefined;
  if (s3) {
    try {
      s3.destroy();
    } catch {
      // ignore
    }
  }
  s3 = undefined;
  s3Bucket = undefined;
}
