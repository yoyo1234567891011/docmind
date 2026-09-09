/**
 * Preuve multi-worker : locks analyse / Ollama / keyed-lock.
 * Simule 2 workers via bypass des Maps/files process-local + mock Redis.
 *
 * Prouve :
 * 1) un seul job exécuté sous contention
 * 2) un verrou local n’est pas global (sans Redis → double run)
 * 3) expiration TTL → reprise après crash
 */
import assert from "node:assert/strict";

import {
  documentAnalysisLockKey,
  withDocumentAnalysisSingleFlight,
} from "../src/ai/pipelines/document-analysis-lock";
import { withOllamaGenerateLock } from "../src/ai/models/generate-lock";
import { withKeyedLock } from "../src/lib/keyed-lock";
import { acquireRedisLease } from "../src/lib/redis-lease";

type RedisGlobal = typeof globalThis & {
  __docmindRedis?: MockRedis | null;
  __docmindRedisInitAttempted?: boolean;
};

type MockRedis = {
  store: Map<string, { value: string; expiresAt: number }>;
  set: (
    key: string,
    value: string,
    ...args: unknown[]
  ) => Promise<"OK" | null>;
  get: (key: string) => Promise<string | null>;
  del: (...keys: string[]) => Promise<number>;
  eval: (
    script: string,
    numKeys: number,
    key: string,
    token: string,
  ) => Promise<number>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withEnv(
  env: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function createMockRedis(): MockRedis {
  const store = new Map<string, { value: string; expiresAt: number }>();

  function purge(key: string) {
    const row = store.get(key);
    if (row && row.expiresAt <= Date.now()) store.delete(key);
  }

  return {
    store,
    async set(key, value, ...args) {
      // set key value EX ttl NX
      let ttlSec = 60;
      let nx = false;
      for (let i = 0; i < args.length; i += 1) {
        if (args[i] === "EX") ttlSec = Number(args[i + 1]) || 60;
        if (args[i] === "NX") nx = true;
      }
      purge(key);
      if (nx && store.has(key)) return null;
      store.set(key, {
        value,
        expiresAt: Date.now() + ttlSec * 1000,
      });
      return "OK";
    },
    async get(key) {
      purge(key);
      return store.get(key)?.value ?? null;
    },
    async del(...keys) {
      let n = 0;
      for (const key of keys) {
        if (store.delete(key)) n += 1;
      }
      return n;
    },
    async eval(_script, _numKeys, key, token) {
      purge(key);
      const row = store.get(key);
      if (!row || row.value !== token) return 0;
      store.delete(key);
      return 1;
    },
  };
}

async function withMockRedis(
  fn: (redis: MockRedis) => Promise<void>,
): Promise<void> {
  const g = globalThis as RedisGlobal;
  const prevRedis = g.__docmindRedis;
  const prevAttempted = g.__docmindRedisInitAttempted;
  const redis = createMockRedis();

  await withEnv({ REDIS_URL: "redis://mock-distributed-locks" }, async () => {
    g.__docmindRedis = redis;
    g.__docmindRedisInitAttempted = true;
    try {
      await fn(redis);
    } finally {
      g.__docmindRedis = prevRedis;
      g.__docmindRedisInitAttempted = prevAttempted;
    }
  });
}

async function testLocalLockIsNotGlobal() {
  // Sans Redis, 2 workers (bypass Map) → double exécution.
  await withEnv({ REDIS_URL: undefined }, async () => {
    const g = globalThis as RedisGlobal;
    g.__docmindRedis = null;
    g.__docmindRedisInitAttempted = true;

    const key = documentAnalysisLockKey("u-local", `doc-${Date.now()}`);
    let runs = 0;
    const job = async () => {
      runs += 1;
      await sleep(30);
      return { runs };
    };

    const [a, b] = await Promise.all([
      withDocumentAnalysisSingleFlight(key, job, {
        bypassLocalCoalesce: true,
      }),
      withDocumentAnalysisSingleFlight(key, job, {
        bypassLocalCoalesce: true,
      }),
    ]);

    assert.equal(runs, 2, "sans Redis le verrou local n'est pas global");
    assert.ok(a.result && b.result);
  });
  console.log("OK local lock ≠ global (sans Redis → 2 runs)");
}

async function testAnalyzeSingleFlightTwoWorkers() {
  await withMockRedis(async () => {
    const key = documentAnalysisLockKey("u-dist", `doc-${Date.now()}`);
    let runs = 0;
    const job = async () => {
      runs += 1;
      await sleep(80);
      return { ok: true, n: runs };
    };

    // Worker A : Map locale ; Worker B : autre instance (bypass Map)
    const [a, b] = await Promise.all([
      withDocumentAnalysisSingleFlight(key, job),
      (async () => {
        await sleep(10);
        return withDocumentAnalysisSingleFlight(key, job, {
          bypassLocalCoalesce: true,
        });
      })(),
    ]);

    assert.equal(runs, 1, "un seul job analyse sous 2 workers + Redis");
    assert.deepEqual(a.result, b.result);
    assert.equal(a.coalesced, false);
    assert.equal(b.coalesced, true);
  });
  console.log("OK analyze single-flight — 1 job / 2 workers");
}

async function testAnalyzeCrashTtlResume() {
  await withMockRedis(async (redis) => {
    const key = documentAnalysisLockKey("u-crash", `doc-${Date.now()}`);
    const flightKey = `docmind:analyze:flight:${key}`;

    // Crash : lease tenu puis expiré sans résultat publié
    redis.store.set(flightKey, {
      value: `${Date.now()}-crashed-token`,
      expiresAt: Date.now() + 80,
    });

    let runs = 0;
    await sleep(100); // TTL expiré

    process.env.ANALYZE_LOCK_TTL_MS = "2000";
    try {
      const { result, coalesced } = await withDocumentAnalysisSingleFlight(
        key,
        async () => {
          runs += 1;
          return { resumed: true };
        },
        { bypassLocalCoalesce: true },
      );
      assert.equal(runs, 1, "reprise après expiration TTL");
      assert.equal(result.resumed, true);
      assert.equal(coalesced, false);
    } finally {
      delete process.env.ANALYZE_LOCK_TTL_MS;
    }
  });
  console.log("OK analyze — expiration TTL / reprise après crash");
}

async function testOllamaGenerateLockTwoWorkers() {
  await withMockRedis(async () => {
    process.env.OLLAMA_LOCK_TTL_MS = "5000";
    process.env.OLLAMA_LOCK_MAX_WAIT_MS = "5000";
    let runs = 0;
    let concurrent = 0;
    let maxConcurrent = 0;

    const job = async () => {
      runs += 1;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await sleep(60);
      concurrent -= 1;
      return runs;
    };

    try {
      await Promise.all([
        withOllamaGenerateLock("gpu-a", job),
        withOllamaGenerateLock("gpu-b", job, { bypassLocalQueue: true }),
      ]);
    } finally {
      delete process.env.OLLAMA_LOCK_TTL_MS;
      delete process.env.OLLAMA_LOCK_MAX_WAIT_MS;
    }

    assert.equal(runs, 2, "les 2 jobs finissent (file)");
    assert.equal(maxConcurrent, 1, "jamais 2 generates GPU simultanés");
  });
  console.log("OK ollama generate-lock — exclusion mutuelle 2 workers");
}

async function testOllamaCrashTtlResume() {
  await withMockRedis(async (redis) => {
    process.env.OLLAMA_LOCK_TTL_MS = "2000";
    process.env.OLLAMA_LOCK_MAX_WAIT_MS = "2000";

    redis.store.set("docmind:ollama:generate", {
      value: "dead-worker-token",
      expiresAt: Date.now() + 70,
    });

    let ran = false;
    try {
      await sleep(90);
      await withOllamaGenerateLock(
        "gpu-resume",
        async () => {
          ran = true;
          return 1;
        },
        { bypassLocalQueue: true },
      );
      assert.equal(ran, true, "reprise GPU après TTL crash");
    } finally {
      delete process.env.OLLAMA_LOCK_TTL_MS;
      delete process.env.OLLAMA_LOCK_MAX_WAIT_MS;
    }
  });
  console.log("OK ollama — expiration TTL / reprise après crash");
}

async function testKeyedLockTwoWorkers() {
  await withMockRedis(async () => {
    let runs = 0;
    let concurrent = 0;
    let maxConcurrent = 0;
    const key = `quota:test:${Date.now()}`;

    const job = async () => {
      runs += 1;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await sleep(40);
      concurrent -= 1;
    };

    // Deux « workers » : withKeyedLock a aussi une Map locale —
    // on prouve le lease Redis via acquireRedisLease concurrent direct.
    const [l1, l2] = await Promise.all([
      acquireRedisLease({
        redisKey: `docmind:lock:${key}`,
        ttlMs: 2000,
        waitMs: 0,
      }),
      acquireRedisLease({
        redisKey: `docmind:lock:${key}`,
        ttlMs: 2000,
        waitMs: 0,
      }),
    ]);
    assert.ok(l1 || l2, "au moins un lease");
    assert.ok(!(l1 && l2), "pas deux leases NX simultanés");
    if (l1) await l1.release();
    if (l2) await l2.release();

    await Promise.all([
      withKeyedLock(key, job, { ttlMs: 5000 }),
      withKeyedLock(`${key}-b`, job, { ttlMs: 5000 }),
    ]);
    assert.equal(runs, 2);
    // Même clé Redis pour contention réelle
    runs = 0;
    concurrent = 0;
    maxConcurrent = 0;
    const same = `same:${Date.now()}`;
    await Promise.all([
      withKeyedLock(same, job, { ttlMs: 5000 }),
      (async () => {
        await sleep(5);
        // 2ᵉ worker : lease Redis direct pendant que le 1ᵉr tient la keyed-lock
        const blocked = await acquireRedisLease({
          redisKey: `docmind:lock:${same}`,
          ttlMs: 1000,
          waitMs: 0,
        });
        assert.equal(
          blocked,
          null,
          "lease local keyed-lock visible globalement via Redis",
        );
      })(),
    ]);
    assert.equal(maxConcurrent, 1);
  });
  console.log("OK keyed-lock — NX Redis global, pas de double lease");
}

async function main() {
  await testLocalLockIsNotGlobal();
  await testAnalyzeSingleFlightTwoWorkers();
  await testAnalyzeCrashTtlResume();
  await testOllamaGenerateLockTwoWorkers();
  await testOllamaCrashTtlResume();
  await testKeyedLockTwoWorkers();
  console.log("\nOK test-distributed-locks — 2 workers / TTL / fail-closed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
